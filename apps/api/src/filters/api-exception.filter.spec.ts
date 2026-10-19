// Learning path Step 18: Telemetry and audit baseline.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-18-telemetry-and-audit-baseline
// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiExceptionFilter } from './api-exception.filter.js'
import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'
import type { TelemetryService } from '../modules/telemetry/telemetry.service.js'
import type * as PinoConfig from '../logger/pino.config'

const { logErrorMock } = vi.hoisted(() => ({ logErrorMock: vi.fn() }))

vi.mock('../logger/pino.config', async (importOriginal) => ({
  ...(await importOriginal<typeof PinoConfig>()),
  createBaseLogger: () => ({ child: () => ({ error: logErrorMock }) }),
}))

describe('ApiExceptionFilter', () => {
  let filter: ApiExceptionFilter
  let mockAdapterHost: HttpAdapterHost
  let mockTelemetryService: TelemetryService
  let captureEventMock: ReturnType<typeof vi.fn>
  let replyMock: ReturnType<typeof vi.fn>
  let endMock: ReturnType<typeof vi.fn>
  let isHeadersSentMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    logErrorMock.mockClear()
    replyMock = vi.fn()
    endMock = vi.fn()
    isHeadersSentMock = vi.fn().mockReturnValue(false)
    const mockHttpAdapter = {
      reply: replyMock,
      end: endMock,
      isHeadersSent: isHeadersSentMock,
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
      getArgByIndex: vi.fn((index: number) => [fakeRequest, fakeResponse][index]),
      getArgs: vi.fn().mockReturnValue([fakeRequest, fakeResponse]),
    } as unknown as ArgumentsHost

    const exception = new HttpException('Invalid payload', HttpStatus.BAD_REQUEST)

    filter.catch(exception, mockHost)

    expect(replyMock).toHaveBeenCalledExactlyOnceWith(
      fakeResponse,
      { statusCode: 400, message: 'Invalid payload' },
      400
    )
    expect(logErrorMock).not.toHaveBeenCalled()
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

  it('returns the shared 500 envelope, logs the original failure, and captures telemetry', () => {
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
      getArgByIndex: vi.fn((index: number) => [fakeRequest, fakeResponse][index]),
      getArgs: vi.fn().mockReturnValue([fakeRequest, fakeResponse]),
    } as unknown as ArgumentsHost

    const exception = new Error('Unexpected database failure: private connection details')

    filter.catch(exception, mockHost)

    expect(replyMock).toHaveBeenCalledExactlyOnceWith(
      fakeResponse,
      {
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
      },
      500
    )
    expect(JSON.stringify(replyMock.mock.calls[0]?.[1])).not.toContain(
      'private connection details'
    )
    expect(logErrorMock).toHaveBeenCalledExactlyOnceWith(
      { err: exception },
      expect.any(String)
    )
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
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND)

    // Must not throw.
    expect(() => filter.catch(exception, buildHost(undefined))).not.toThrow()
    expect(captureEventMock).not.toHaveBeenCalled()
  })

  const buildHost = (
    request: unknown,
    response: unknown = { headersSent: false }
  ): ArgumentsHost => {
    return {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue(request),
        getResponse: vi.fn().mockReturnValue(response),
      }),
      getType: vi.fn().mockReturnValue('http'),
      getArgByIndex: vi.fn((index: number) => [request, response][index]),
      getArgs: vi.fn().mockReturnValue([request, response]),
    } as unknown as ArgumentsHost
  }

  it('preserves a custom HttpException envelope', () => {
    const response = { headersSent: false }
    const envelope = {
      statusCode: 409,
      error: 'Conflict',
      message: 'Reaction revision changed.',
      data: { revision: 3 },
    }

    filter.catch(
      new HttpException(envelope, HttpStatus.CONFLICT),
      buildHost({ path: '/api/v1/community/posts/post-1/reaction' }, response)
    )

    expect(replyMock).toHaveBeenCalledExactlyOnceWith(response, envelope, 409)
    expect(logErrorMock).not.toHaveBeenCalled()
  })

  it('preserves the status and message of an http-errors exception', () => {
    const response = { headersSent: false }
    const exception = { statusCode: 400, message: 'Malformed JSON' }

    filter.catch(exception, buildHost({ path: '/api/v1/outfits' }, response))

    expect(replyMock).toHaveBeenCalledExactlyOnceWith(
      response,
      { statusCode: 400, message: 'Malformed JSON' },
      400
    )
    expect(logErrorMock).not.toHaveBeenCalled()
  })

  it('ends an already-started response while logging and capturing an unexpected failure', () => {
    isHeadersSentMock.mockReturnValue(true)
    const response = { headersSent: true }
    const exception = new Error('Stream failed')

    filter.catch(
      exception,
      buildHost({ path: '/api/v1/outfits', method: 'POST' }, response)
    )

    expect(isHeadersSentMock).toHaveBeenCalledWith(response)
    expect(replyMock).not.toHaveBeenCalled()
    expect(endMock).toHaveBeenCalledExactlyOnceWith(response)
    expect(logErrorMock).toHaveBeenCalledExactlyOnceWith(
      { err: exception },
      expect.any(String)
    )
    expect(captureEventMock).toHaveBeenCalledWith(
      null,
      'api_error_occurred',
      expect.objectContaining({ statusCode: 500, errorCode: 'INTERNAL_ERROR' })
    )
  })

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
    const response = { headersSent: false }
    const exception = new Error('Database unavailable')

    filter.catch(
      exception,
      buildHost({ path: '/api/v1/alerts', method: 'GET' }, response)
    )

    expect(replyMock).toHaveBeenCalledExactlyOnceWith(
      response,
      {
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
      },
      500
    )
    expect(logErrorMock).toHaveBeenCalledWith({ err: exception }, expect.any(String))
    expect(catchSpy).toHaveBeenCalledWith(expect.any(Function))
    const onRejected = catchSpy.mock.calls[0]?.[0] as (err: unknown) => void
    const telemetryFailure = new Error('posthog unreachable')
    expect(() => onRejected(telemetryFailure)).not.toThrow()
    expect(logErrorMock).toHaveBeenCalledWith(
      { err: telemetryFailure },
      'Failed to dispatch api_error_occurred telemetry event'
    )
    expect(replyMock).toHaveBeenCalledTimes(1)
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
    it('normalizes and logs an unexpected webhook failure while excluding telemetry', () => {
      const exception = new Error('Webhook processing failed')
      const response = { headersSent: false }

      filter.catch(
        exception,
        buildHost(
          { path: '/API/v1/Commerce/Affiliate/Webhook/', method: 'POST' },
          response
        )
      )

      expect(replyMock).toHaveBeenCalledExactlyOnceWith(
        response,
        {
          statusCode: 500,
          message: 'Internal server error',
          error: 'Internal Server Error',
        },
        500
      )
      expect(logErrorMock).toHaveBeenCalledExactlyOnceWith(
        { err: exception },
        expect.any(String)
      )
      expect(captureEventMock).not.toHaveBeenCalled()
    })

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
    const telemetryFailure = new Error('telemetry client not initialised')
    captureEventMock.mockImplementation(() => {
      throw telemetryFailure
    })
    const response = { headersSent: false }
    const exception = new Error('Database unavailable')

    expect(() =>
      filter.catch(
        exception,
        buildHost({ path: '/api/v1/alerts', method: 'GET' }, response)
      )
    ).not.toThrow()
    expect(replyMock).toHaveBeenCalledExactlyOnceWith(
      response,
      {
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
      },
      500
    )
    expect(logErrorMock).toHaveBeenCalledWith({ err: exception }, expect.any(String))
    expect(logErrorMock).toHaveBeenCalledWith(
      { err: telemetryFailure },
      'Error in global API exception filter telemetry extraction'
    )
  })
})
