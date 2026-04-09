// Step 11 verification owner: searchable owner anchor
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { trace } from '@opentelemetry/api'
import type { IncomingHttpHeaders } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { Writable } from 'node:stream'
import request from 'supertest'
import {
  createLogExpectations,
  type MemoryLogEntry,
} from '@couture/api-client/testing/observability-assertions'
import {
  initializeOpenTelemetry,
  resetOpenTelemetryForTests,
  shutdownOpenTelemetry,
} from '../src/instrumentation'
import { createBaseLogger } from '../src/logger/pino.config'
import { bindRequestContext } from '../src/logger/request-context'
import { createRequestLoggerMiddleware } from '../src/logger/request-logger.middleware'
import { AuthModule } from '../src/modules/auth/auth.module'

vi.mock('posthog-node', () => ({
  PostHog: class PostHogMock {
    capture = vi.fn()
    getFeatureFlag = vi.fn()
    shutdown = vi.fn()
  },
}))

type CapturedOtlpRequest = {
  body: Record<string, unknown> | null
  headers: IncomingHttpHeaders
  method: string
  url: string
}

type OtlpAttribute = {
  key?: unknown
  value?: {
    stringValue?: unknown
  }
}

type OtlpSpan = {
  attributes?: OtlpAttribute[]
  name?: unknown
}

type OtlpResourceSpan = {
  resource?: {
    attributes?: OtlpAttribute[]
  }
  scopeSpans?: {
    spans?: OtlpSpan[]
  }[]
}

class JsonMemoryStream extends Writable {
  readonly entries: MemoryLogEntry[] = []

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    const lines = chunk
      .toString()
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)

    for (const line of lines) {
      this.entries.push(JSON.parse(line) as MemoryLogEntry)
    }

    callback()
  }
}

function findStringAttribute(
  attributes: OtlpAttribute[] | undefined,
  key: string
): string | undefined {
  const attribute = attributes?.find((candidate) => candidate.key === key)
  const stringValue = attribute?.value?.stringValue
  return typeof stringValue === 'string' ? stringValue : undefined
}

function flattenExportedSpans(resourceSpans: OtlpResourceSpan[]): OtlpSpan[] {
  return resourceSpans.flatMap((resourceSpan) =>
    (resourceSpan.scopeSpans ?? []).flatMap((scopeSpan) => scopeSpan.spans ?? [])
  )
}

function waitForTraceExport(
  promise: Promise<CapturedOtlpRequest>,
  timeoutMs = 10_000
): Promise<CapturedOtlpRequest> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting ${timeoutMs}ms for OTLP trace export`))
    }, timeoutMs)

    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

async function createOtlpCaptureServer() {
  let resolveTraceRequest: ((request: CapturedOtlpRequest) => void) | undefined
  const traceRequestPromise = new Promise<CapturedOtlpRequest>((resolve) => {
    resolveTraceRequest = resolve
  })

  const server = createServer((incomingMessage, serverResponse) => {
    void (async () => {
      let rawBody = ''

      for await (const chunk of incomingMessage) {
        if (typeof chunk === 'string') {
          rawBody += chunk
          continue
        }

        if (chunk instanceof Uint8Array) {
          rawBody += Buffer.from(chunk).toString('utf8')
        }
      }

      const capturedRequest: CapturedOtlpRequest = {
        body:
          rawBody.length > 0 ? (JSON.parse(rawBody) as Record<string, unknown>) : null,
        headers: incomingMessage.headers,
        method: incomingMessage.method ?? 'GET',
        url: incomingMessage.url ?? '/',
      }

      if (capturedRequest.url.endsWith('/v1/traces')) {
        resolveTraceRequest?.(capturedRequest)
        resolveTraceRequest = undefined
      }

      serverResponse.writeHead(200, { 'content-type': 'application/json' })
      serverResponse.end('{}')
    })().catch((error: unknown) => {
      serverResponse.statusCode = 500
      serverResponse.end(error instanceof Error ? error.message : String(error))
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const address = server.address() as AddressInfo
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      }),
    endpoint: `http://127.0.0.1:${address.port}/otlp`,
    traceRequestPromise,
  }
}

describe('observability integration', () => {
  let app: INestApplication | undefined

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  beforeEach(async () => {
    await shutdownOpenTelemetry()
    resetOpenTelemetryForTests()
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }

    await shutdownOpenTelemetry()
    resetOpenTelemetryForTests()
  })

  it('exports OTLP traces to the configured Grafana endpoint', async () => {
    const otlpServer = await createOtlpCaptureServer()

    try {
      const initialized = initializeOpenTelemetry({
        GRAFANA_API_KEY: 'secret',
        GRAFANA_INSTANCE_ID: '1555123',
        GRAFANA_OTLP_ENDPOINT: otlpServer.endpoint,
        NODE_ENV: 'development',
      })

      expect(initialized).toBe(true)

      trace
        .getTracer('story-0.7-task-10')
        .startActiveSpan('guardian_consent_trace_check', (span) => {
          span.setAttribute('feature', 'auth')
          span.setAttribute('story.task', '0.7-task-10')
          span.end()
        })

      await shutdownOpenTelemetry()

      const otlpRequest = await waitForTraceExport(otlpServer.traceRequestPromise)
      expect(otlpRequest.method).toBe('POST')
      expect(otlpRequest.url).toBe('/otlp/v1/traces')
      expect(otlpRequest.headers.authorization).toBe('Basic MTU1NTEyMzpzZWNyZXQ=')
      expect(otlpRequest.headers['content-type']).toContain('application/json')

      const resourceSpans = Array.isArray(otlpRequest.body?.resourceSpans)
        ? (otlpRequest.body.resourceSpans as OtlpResourceSpan[])
        : []
      expect(resourceSpans.length).toBeGreaterThan(0)
      expect(
        findStringAttribute(resourceSpans[0]?.resource?.attributes, 'service.name')
      ).toBe('couturecast-api')

      const spans = flattenExportedSpans(resourceSpans)
      expect(spans).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'guardian_consent_trace_check',
          }),
        ])
      )

      const exportedSpan = spans.find(
        (candidate) => candidate.name === 'guardian_consent_trace_check'
      )
      expect(findStringAttribute(exportedSpan?.attributes, 'feature')).toBe('auth')
      expect(findStringAttribute(exportedSpan?.attributes, 'story.task')).toBe(
        '0.7-task-10'
      )
    } finally {
      await otlpServer.close()
    }
  })

  it('emits structured request logs with the requestId attached', async () => {
    const stream = new JsonMemoryStream()
    const env = { LOG_LEVEL: 'info' }
    const logger = createBaseLogger({ destination: stream, env })
    const logExpectations = createLogExpectations(stream.entries, expect)
    const requestId = 'req-observe-123'

    const moduleFixture = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.use(bindRequestContext)
    app.use(createRequestLoggerMiddleware({ env, logger }))
    await app.init()

    const logCursor = logExpectations.createCursor()
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .set('authorization', 'Bearer test-token')
      .set('x-request-id', requestId)
      .set('x-user-id', 'guardian-123')
      .set('x-user-role', 'guardian')
      .send({
        guardianId: 'guardian-123',
        teenId: 'teen-123',
        consentLevel: 'full',
        timestamp: '2026-03-21T12:00:00.000Z',
      })

    expect(response.status).toBe(200)
    expect(response.headers['x-request-id']).toBe(requestId)

    logExpectations.expectLogEntry(
      'info',
      'request_received',
      {
        feature: 'auth',
        path: '/api/v1/auth/guardian-consent',
        requestId,
        timestamp: expect.any(String),
      },
      { afterIndex: logCursor, count: 1 }
    )
    logExpectations.expectLogEntry(
      'info',
      'request_completed',
      {
        feature: 'auth',
        path: '/api/v1/auth/guardian-consent',
        requestId,
        statusCode: 200,
        timestamp: expect.any(String),
        userId: 'guardian-123',
      },
      { afterIndex: logCursor, count: 1 }
    )
  })
})
