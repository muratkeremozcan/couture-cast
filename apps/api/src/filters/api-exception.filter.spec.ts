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
        endpoint: '/api/v1/weather/chicago-il',
        method: 'GET',
        statusCode: 400,
        errorMessage: 'Invalid payload',
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
        endpoint: '/api/v1/outfits',
        method: 'POST',
        statusCode: 500,
        errorMessage: 'Unexpected database failure',
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
})
