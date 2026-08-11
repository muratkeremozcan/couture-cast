import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiExceptionFilter } from './api-exception.filter.js'
import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'
import type { TelemetryService } from '../modules/telemetry/telemetry.service.js'

describe('ApiExceptionFilter', () => {
  let filter: ApiExceptionFilter
  let mockAdapterHost: HttpAdapterHost
  let mockTelemetryService: TelemetryService
  let captureEventMock: ReturnType<typeof vi.fn>
  let replyMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    replyMock = vi.fn()
    const mockHttpAdapter = {
      reply: replyMock,
      isHeadersSent: vi.fn().mockReturnValue(false),
    }
    mockAdapterHost = {
      httpAdapter: mockHttpAdapter,
    } as unknown as HttpAdapterHost

    captureEventMock = vi.fn().mockResolvedValue(undefined)
    mockTelemetryService = {
      captureEvent: captureEventMock,
    } as unknown as TelemetryService

    filter = new ApiExceptionFilter(mockAdapterHost, mockTelemetryService)
  })

  it('delegates to BaseExceptionFilter and captures telemetry for HttpExceptions', () => {
    const fakeRequest = {
      url: '/api/v1/weather/chicago-il',
      method: 'GET',
      auth: { userId: 'user-1' },
    }
    const fakeResponse = { headersSent: false }

    const getRequest = vi.fn().mockReturnValue(fakeRequest)
    const getResponse = vi.fn().mockReturnValue(fakeResponse)

    const mockHost: ArgumentsHost = {
      switchToHttp: vi.fn().mockReturnValue({ getRequest, getResponse }),
      getType: vi.fn().mockReturnValue('http'),
      getArgByIndex: vi.fn().mockReturnValue(fakeRequest),
      getArgs: vi.fn().mockReturnValue([fakeRequest, fakeResponse]),
    } as unknown as ArgumentsHost

    const exception = new HttpException('Invalid payload', HttpStatus.BAD_REQUEST)

    filter.catch(exception, mockHost)

    expect(replyMock).toHaveBeenCalled()
    expect(captureEventMock).toHaveBeenCalledWith(
      'user-1',
      'api_error_occurred',
      expect.objectContaining({
        userId: 'user-1',
        route: '/api/v1/weather/chicago-il',
        method: 'GET',
        statusCode: 400,
        errorCode: 'BAD_REQUEST',
      })
    )
  })

  it('captures a 500 status code and raw message for non-HttpExceptions', () => {
    const fakeRequest = {
      url: '/api/v1/outfits',
      method: 'POST',
      auth: { userId: 'user-2' },
    }
    const fakeResponse = { headersSent: false }

    const getRequest = vi.fn().mockReturnValue(fakeRequest)
    const getResponse = vi.fn().mockReturnValue(fakeResponse)

    const mockHost: ArgumentsHost = {
      switchToHttp: vi.fn().mockReturnValue({ getRequest, getResponse }),
      getType: vi.fn().mockReturnValue('http'),
      getArgByIndex: vi.fn().mockReturnValue(fakeRequest),
      getArgs: vi.fn().mockReturnValue([fakeRequest, fakeResponse]),
    } as unknown as ArgumentsHost

    // A plain Error (not an HttpException) should be treated as 500.
    const exception = new Error('Unexpected database failure')

    filter.catch(exception, mockHost)

    expect(replyMock).toHaveBeenCalled()
    expect(captureEventMock).toHaveBeenCalledWith(
      'user-2',
      'api_error_occurred',
      expect.objectContaining({
        userId: 'user-2',
        route: '/api/v1/outfits',
        method: 'POST',
        statusCode: 500,
        errorCode: 'INTERNAL_ERROR',
      })
    )
  })

  it('skips telemetry capture when the request object is unavailable', () => {
    // Some exception contexts (e.g. WebSocket, RPC) may not produce an HTTP
    // request object; the filter must not throw in those cases.
    const getRequest = vi.fn().mockReturnValue(undefined)
    const getResponse = vi.fn().mockReturnValue({})

    const mockHost: ArgumentsHost = {
      switchToHttp: vi.fn().mockReturnValue({ getRequest, getResponse }),
      getType: vi.fn().mockReturnValue('http'),
      getArgByIndex: vi.fn().mockReturnValue(undefined),
      getArgs: vi.fn().mockReturnValue([undefined, {}]),
    } as unknown as ArgumentsHost

    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND)

    // Must not throw.
    expect(() => filter.catch(exception, mockHost)).not.toThrow()
    expect(captureEventMock).not.toHaveBeenCalled()
  })

  const buildHost = (request: unknown): ArgumentsHost => {
    const response = { headersSent: false }
    return {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue(request),
        getResponse: vi.fn().mockReturnValue(response),
      }),
      getType: vi.fn().mockReturnValue('http'),
      getArgByIndex: vi.fn().mockReturnValue(request),
      getArgs: vi.fn().mockReturnValue([request, response]),
    } as unknown as ArgumentsHost
  }

  it.each([
    [HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED'],
    [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
    [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
    [HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMIT'],
    [HttpStatus.CONFLICT, 'CLIENT_ERROR'],
    [HttpStatus.BAD_GATEWAY, 'INTERNAL_ERROR'],
  ])('labels status %i as %s in the telemetry event', (status, errorCode) => {
    // The error code is what dashboards group on, so each class must stay distinct.
    const host = buildHost({ path: '/api/v1/alerts', method: 'GET', auth: {} })

    filter.catch(new HttpException('boom', status), host)

    expect(captureEventMock).toHaveBeenCalledWith(
      null,
      'api_error_occurred',
      expect.objectContaining({ statusCode: status, errorCode })
    )
  })

  it('prefers the routing path and drops the query string from a raw url', () => {
    // Query strings carry user data and would explode telemetry cardinality.
    filter.catch(
      new HttpException('boom', HttpStatus.BAD_REQUEST),
      buildHost({ url: '/api/v1/weather/chicago-il?units=metric', method: 'GET' })
    )

    expect(captureEventMock).toHaveBeenCalledWith(
      null,
      'api_error_occurred',
      expect.objectContaining({ route: '/api/v1/weather/chicago-il', method: 'GET' })
    )
  })

  it('falls back to unknown route and method when the request carries neither', () => {
    filter.catch(new HttpException('boom', HttpStatus.BAD_REQUEST), buildHost({}))

    expect(captureEventMock).toHaveBeenCalledWith(
      null,
      'api_error_occurred',
      expect.objectContaining({ route: 'unknown', method: 'unknown', userId: null })
    )
  })

  it('attaches a rejection handler so a telemetry outage cannot escape the filter', () => {
    // The dispatch is fire-and-forget; an unhandled rejection here would crash
    // the process on an error path that is already degraded.
    const catchSpy = vi.fn()
    captureEventMock.mockReturnValue({ catch: catchSpy })

    filter.catch(
      new HttpException('boom', HttpStatus.BAD_REQUEST),
      buildHost({ path: '/api/v1/alerts', method: 'GET' })
    )

    expect(catchSpy).toHaveBeenCalledWith(expect.any(Function))
    const onRejected = catchSpy.mock.calls[0]?.[0] as (err: unknown) => void
    expect(() => onRejected(new Error('posthog unreachable'))).not.toThrow()
  })

  it.each([
    { name: 'nothing at all', value: undefined },
    { name: 'a non-thenable value', value: { ok: true } },
  ])('tolerates a telemetry service that returns $name', ({ value }) => {
    captureEventMock.mockReturnValue(value)

    expect(() =>
      filter.catch(
        new HttpException('boom', HttpStatus.BAD_REQUEST),
        buildHost({ path: '/api/v1/alerts', method: 'GET' })
      )
    ).not.toThrow()
  })

  describe('affiliate webhook exclusion', () => {
    it.each([
      { name: 'the exact route', path: '/api/v1/commerce/affiliate/webhook' },
      { name: 'a trailing slash', path: '/api/v1/commerce/affiliate/webhook/' },
      { name: 'an uppercased path', path: '/API/V1/Commerce/Affiliate/Webhook' },
    ])(
      'writes no api_error_occurred row for a rejected webhook reached via $name',
      ({ path }) => {
        // The endpoint is unauthenticated, so one telemetry row per rejected
        // request is a free amplification vector against a table pruned hourly.
        // Express matches routes case-insensitively and tolerates trailing
        // slashes, so the exclusion has to normalize before it compares.
        const host = buildHost({ path, method: 'POST' })

        filter.catch(new HttpException('Invalid webhook signature.', 401), host)

        expect(replyMock).toHaveBeenCalled()
        expect(captureEventMock).not.toHaveBeenCalled()
      }
    )

    it('drops the query string before deciding whether to exclude', () => {
      filter.catch(
        new HttpException('Invalid webhook signature.', 401),
        buildHost({
          url: '/api/v1/commerce/affiliate/webhook?retry=7',
          method: 'POST',
        })
      )

      expect(captureEventMock).not.toHaveBeenCalled()
    })

    it('still captures errors on neighbouring commerce routes', () => {
      // The exclusion is one route, not the whole commerce namespace: the
      // authenticated click endpoint has a bearer token in front of it and its
      // errors are worth counting.
      filter.catch(
        new HttpException('Affiliate offer not found.', 404),
        buildHost({ path: '/api/v1/commerce/affiliate/clicks', method: 'POST' })
      )

      expect(captureEventMock).toHaveBeenCalledWith(
        null,
        'api_error_occurred',
        expect.objectContaining({ route: '/api/v1/commerce/affiliate/clicks' })
      )
    })
  })

  it('still returns the HTTP response when telemetry extraction throws', () => {
    // Telemetry is best-effort; the client must still receive its error response.
    captureEventMock.mockImplementation(() => {
      throw new Error('telemetry client not initialised')
    })

    expect(() =>
      filter.catch(
        new HttpException('boom', HttpStatus.BAD_REQUEST),
        buildHost({ path: '/api/v1/alerts', method: 'GET' })
      )
    ).not.toThrow()
    expect(replyMock).toHaveBeenCalled()
  })
})
