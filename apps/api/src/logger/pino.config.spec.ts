import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createBaseLogger, resolveLogLevel, resolveTraceContext } from './pino.config'
import { runWithRequestContext } from './request-context'

class MemoryStream extends Writable {
  readonly chunks: string[] = []

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.chunks.push(chunk.toString())
    callback()
  }
}

function parseLastLogLine(stream: MemoryStream) {
  return JSON.parse(stream.chunks.at(-1) ?? '{}') as Record<string, unknown>
}

describe('pino.config', () => {
  it('maps environment names to expected log levels', () => {
    expect(resolveLogLevel({})).toBe('debug')
    expect(resolveLogLevel({ NODE_ENV: 'development' })).toBe('info')
    expect(resolveLogLevel({ NODE_ENV: 'production' })).toBe('warn')
    expect(resolveLogLevel({ LOG_LEVEL: 'error' })).toBe('error')
  })

  it('returns an empty trace object when no active span exists', () => {
    expect(resolveTraceContext({ getActiveSpan: () => undefined })).toEqual({})
  })

  it('extracts OTEL trace identifiers from the active span', () => {
    expect(
      resolveTraceContext({
        getActiveSpan: () => ({
          spanContext: () => ({
            spanId: 'span-123',
            traceFlags: 1,
            traceId: 'trace-456',
          }),
        }),
      })
    ).toEqual({
      spanId: 'span-123',
      traceFlags: 1,
      traceId: 'trace-456',
    })
  })

  it('emits structured log fields from request and trace context', () => {
    const stream = new MemoryStream()
    const logger = createBaseLogger({
      destination: stream,
      env: { LOG_LEVEL: 'info' },
      traceRuntime: {
        getActiveSpan: () => ({
          spanContext: () => ({
            spanId: 'span-123',
            traceFlags: 1,
            traceId: 'trace-456',
          }),
        }),
      },
    })

    runWithRequestContext(
      {
        feature: 'auth',
        requestId: 'req-123',
        userId: 'guardian-123',
      },
      () => logger.info('guardian_consent_recorded')
    )

    expect(parseLastLogLine(stream)).toMatchObject({
      feature: 'auth',
      level: 'info',
      message: 'guardian_consent_recorded',
      requestId: 'req-123',
      spanId: 'span-123',
      traceFlags: 1,
      traceId: 'trace-456',
      userId: 'guardian-123',
    })
    expect(parseLastLogLine(stream).timestamp).toEqual(expect.any(String))
  })
})
