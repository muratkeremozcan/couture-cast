// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), Codex review 5 finding 3: the fixed 400 for an unreadable
// JSON body keeps body text out of the response, but with tracing on, the Express instrumentation
// wraps every middleware and records the error a layer hands on, message included, before the
// scrubber can replace it. This runs the deployed wiring (configureApp) under the instrumentations
// the API's SDK options register, posts bodies that carry a sentinel, and reads every exported span
// attribute, event and status message, next to the response.
import 'reflect-metadata'
import { createRequire } from 'node:module'
import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  type INestApplication,
  type RawBodyRequest,
} from '@nestjs/common'
import type { Request } from 'express'
import { context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import type { Instrumentation } from '@opentelemetry/instrumentation'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenTelemetrySdkOptions } from '../instrumentation'
import type { TelemetryService } from '../modules/telemetry/telemetry.service.js'
import { httpTestUrl, listenHttpApp } from '../testing/loopback-http-app.js'

/** Text that can only come from the posted bodies. */
const SENTINEL = 'ZZSENTINEL4188'
/** Synthetic coordinates no other text in a span could contain, checked one by one. */
const LATITUDE = '41.8761234'
const LONGITUDE = '-87.6549876'
const BODY_FRAGMENTS = [SENTINEL, LATITUDE, LONGITUDE.slice(1)]
const UNREADABLE_BODY = {
  statusCode: 400,
  code: 'invalid_request',
  message: 'The request body could not be read.',
  error: 'Bad Request',
}

@Controller('/api/v1/trace-probe')
class ProbeController {
  @Post()
  @HttpCode(204)
  accept(): string {
    return 'accepted'
  }

  /** What the app parsed, and the exact bytes it kept for signature checks. */
  @Post('echo')
  @HttpCode(200)
  echo(@Body() body: unknown, @Req() request: RawBodyRequest<Request>) {
    return { body, raw: request.rawBody?.toString('utf8') ?? null }
  }
}

const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
let instrumentations: Instrumentation[] = []
let app: INestApplication

function exportedText(span: ReadableSpan): string[] {
  return [
    span.name,
    span.status.message ?? '',
    ...Object.entries(span.attributes).map(([key, value]) => `${key}=${String(value)}`),
    ...span.events.flatMap((event) => [
      event.name,
      ...Object.entries(event.attributes ?? {}).map(
        ([key, value]) => `${key}=${String(value)}`
      ),
    ]),
  ]
}

beforeAll(async () => {
  // The deployed NodeSDK registers this; without it no span has a parent and Express records none.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  const options = createOpenTelemetrySdkOptions({
    GRAFANA_OTLP_ENDPOINT: 'http://127.0.0.1:9/otlp',
    GRAFANA_API_KEY: 'trace-test',
    GRAFANA_INSTANCE_ID: '1',
  })
  if (!options?.instrumentations)
    throw new Error('OTLP export registers no instrumentations')
  instrumentations = options.instrumentations.flat()
  for (const each of instrumentations) each.disable()
  for (const name of [
    '@opentelemetry/instrumentation-http',
    '@opentelemetry/instrumentation-express',
  ]) {
    const selected = instrumentations.find((each) => each.instrumentationName === name)
    if (!selected) throw new Error(`The API registers no ${name}`)
    selected.setTracerProvider(provider)
    selected.enable()
  }
  // Loaded after enable, so the instrumentations patch these copies as the deployed API's are
  // (Nest loads express itself when it creates the app below).
  const load = createRequire(__filename)
  // A worker that already loaded express (another spec) would hand back an unpatched copy, and
  // the instrumentation patches only on load: drop those copies so the next require is patched.
  for (const key of Object.keys(load.cache)) {
    if (/node_modules[\\/](express|router|@nestjs[\\/]platform-express)[\\/]/.test(key))
      delete load.cache[key]
  }
  load('http')
  load('express')
  load('@nestjs/platform-express')
  const { Test } = await import('@nestjs/testing')
  const { configureApp } = await import('./configure-app.js')

  const moduleFixture = await Test.createTestingModule({
    controllers: [ProbeController],
  }).compile()
  // As both API entry points create it (main.ts and api/index.ts): the raw body kept for webhook
  // signatures, and Nest's own parsers off so configureApp's are the only ones.
  app = moduleFixture.createNestApplication({ rawBody: true, bodyParser: false })
  configureApp(app, {
    telemetry: {
      captureEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryService,
    corsOrigins: [],
  })
  await listenHttpApp(app)
})

afterAll(async () => {
  context.disable()
  await app?.close()
  for (const each of instrumentations) each.disable()
  await provider.shutdown()
})

beforeEach(() => {
  exporter.reset()
})

describe('an unreadable JSON body leaves no text in traces', () => {
  it.each([
    // The syntax error sits right next to the coordinates, where a parser excerpt would quote them.
    [
      'a truncated object',
      `{"latitude":${LATITUDE},"longitude":${LONGITUDE},"note":"${SENTINEL}`,
    ],
    ['unquoted names', `{latitude:${LATITUDE},longitude:${LONGITUDE},note:${SENTINEL}}`],
    ['a bare pair', `${LATITUDE},${LONGITUDE}`],
    ['a bare token', `${SENTINEL}=${LATITUDE}`],
  ])('JSON-TRACE-01 %s: fixed 400, and no span carries the body', async (_case, body) => {
    const response = await request(httpTestUrl(app))
      .post('/api/v1/trace-probe')
      .set('content-type', 'application/json')
      .send(body)
    await provider.forceFlush()

    expect(response.status).toBe(400)
    expect(response.body).toStrictEqual(UNREADABLE_BODY)

    const spans = exporter.getFinishedSpans()
    // The instrumentations did trace this request (the check below is not vacuous).
    expect(
      spans.some(
        (span) =>
          span.instrumentationScope.name === '@opentelemetry/instrumentation-express'
      )
    ).toBe(true)
    const exported = spans.flatMap(exportedText)
    // Each fragment of the body on its own: a coordinate alone is a leak too.
    const leaks = exported.filter(
      (text) =>
        BODY_FRAGMENTS.some((fragment) => text.includes(fragment)) ||
        /Unexpected token|in JSON at position|Unterminated/.test(text)
    )
    expect(leaks).toEqual([])
  })

  // Codex product review 6 finding 5: Nest skips its default parser only when it finds one by
  // name, and the instrumentation renames every layer handle to `patched`, so a traced app could
  // run the body through two JSON parsers.
  it('JSON-TRACE-02 the traced app has exactly one JSON parser and one URL-encoded parser', () => {
    const express = app.getHttpAdapter().getInstance() as {
      router?: { stack: { name: string }[] }
      _router?: { stack: { name: string }[] }
    }
    const stack = (express.router ?? express._router)?.stack ?? []
    const names = stack.map((layer) => layer.name)
    expect(names.filter((name) => name === 'jsonParser')).toHaveLength(1)
    expect(names.filter((name) => name === 'urlencodedParser')).toHaveLength(1)
  })

  // The parsers configureApp registers keep working under tracing: URL-encoded forms, the exact
  // raw bytes, and the 100 kB limit.
  describe('valid bodies under tracing', () => {
    const LIMIT_BYTES = 102_400
    const jsonOfLength = (bytes: number) => {
      const body = `{"a":"${'x'.repeat(bytes - 8)}"}`
      expect(Buffer.byteLength(body)).toBe(bytes)
      return body
    }

    it('JSON-TRACE-03 parses a URL-encoded form', async () => {
      const response = await request(httpTestUrl(app))
        .post('/api/v1/trace-probe/echo')
        .set('content-type', 'application/x-www-form-urlencoded')
        .send('city=S%C3%A3o+Paulo&tags%5B%5D=rain&tags%5B%5D=wind')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        body: { city: 'São Paulo', tags: ['rain', 'wind'] },
        raw: 'city=S%C3%A3o+Paulo&tags%5B%5D=rain&tags%5B%5D=wind',
      })
    })

    it('JSON-TRACE-04 keeps the exact JSON bytes, whitespace and non-ASCII included', async () => {
      const raw = '{ "label" : "Zürich  Süd",\n  "n": 1 }'
      const response = await request(httpTestUrl(app))
        .post('/api/v1/trace-probe/echo')
        .set('content-type', 'application/json')
        .send(raw)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ body: { label: 'Zürich  Süd', n: 1 }, raw })
    })

    it('JSON-TRACE-05 accepts 102400 bytes and answers 413 at 102401', async () => {
      const at = await request(httpTestUrl(app))
        .post('/api/v1/trace-probe')
        .set('content-type', 'application/json')
        .send(jsonOfLength(LIMIT_BYTES))
      const over = await request(httpTestUrl(app))
        .post('/api/v1/trace-probe')
        .set('content-type', 'application/json')
        .send(jsonOfLength(LIMIT_BYTES + 1))

      expect(at.status).toBe(204)
      expect(over.status).toBe(413)
    })
  })
})
