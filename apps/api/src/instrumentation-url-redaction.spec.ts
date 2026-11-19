// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), review finding: the auto-instrumentations exported every
// outgoing provider URL to Grafana, query included, and so the provider API key (`appid`, `key`),
// the city search text (`q`) and the approximate device position (`lat`, `lon`). This drives real
// requests through the instrumentations the SDK registers and reads every span attribute.
import { createRequire } from 'node:module'
import type * as NodeHttp from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Instrumentation } from '@opentelemetry/instrumentation'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createNodeAutoInstrumentations } from './instrumentation'

const QUERY_TEXT = /\?|appid|key=|lat=|lon=|q=|secret-key|41\.88|87\.63|Chicago/

const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
let instrumentations: Instrumentation[] = []
let http: typeof NodeHttp
let server: NodeHttp.Server
let origin: string

function instrumentation(name: string): Instrumentation {
  const found = instrumentations.find(
    (candidate) => candidate.instrumentationName === name
  )
  if (!found) throw new Error(`${name} is not registered`)
  return found
}

beforeAll(async () => {
  instrumentations = createNodeAutoInstrumentations()
  for (const each of instrumentations) each.disable()
  for (const name of [
    '@opentelemetry/instrumentation-undici',
    '@opentelemetry/instrumentation-http',
  ]) {
    const selected = instrumentation(name)
    selected.setTracerProvider(provider)
    selected.enable()
  }
  // Required after enable, so the http instrumentation patches this copy.
  http = createRequire(__filename)('http') as typeof NodeHttp
  server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('[]')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const each of instrumentations) each.disable()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await provider.shutdown()
})

describe('span URL redaction', () => {
  it('OTEL-URL-01 exports provider calls and incoming searches without their query', async () => {
    const reverse = await fetch(
      `${origin}/geo/1.0/reverse?lat=41.88&lon=-87.63&limit=5&appid=secret-key`
    )
    await reverse.text()
    await new Promise<void>((resolve, reject) => {
      http
        .get(`${origin}/v1/search.json?key=secret-key&q=Chicago`, (response) => {
          response.resume()
          response.on('end', resolve)
        })
        .on('error', reject)
    })
    await provider.forceFlush()

    const spans = exporter.getFinishedSpans()
    const scopes = new Set(spans.map((span) => span.instrumentationScope.name))
    expect(scopes).toEqual(
      new Set([
        '@opentelemetry/instrumentation-undici',
        '@opentelemetry/instrumentation-http',
      ])
    )
    // A client and a server span for each request.
    expect(spans.length).toBeGreaterThanOrEqual(4)

    const leaks = spans.flatMap((span) =>
      Object.entries(span.attributes)
        .filter(([, value]) => typeof value === 'string' && QUERY_TEXT.test(value))
        .map(
          ([key, value]) => `${span.instrumentationScope.name} ${key}=${String(value)}`
        )
    )
    expect(leaks).toEqual([])

    const undici = spans.find(
      (span) => span.instrumentationScope.name === '@opentelemetry/instrumentation-undici'
    )
    expect(undici?.attributes['url.full']).toBe(`${origin}/geo/1.0/reverse`)
    expect(undici?.attributes['url.query']).toBe('')
  })
})
