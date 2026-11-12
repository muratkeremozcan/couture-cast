import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { postHogUpstream, proxyPostHogIngest } from './posthog-ingest-proxy'
import * as route from '../app/ingest/[...path]/route'

type Received = {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: Buffer
}
const received: Received[] = []
let upstream: Server
let origin = ''

beforeAll(async () => {
  upstream = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks),
      })
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-cache')
      response.setHeader('Set-Cookie', 'upstream=1')
      response.setHeader('X-Upstream-Secret', 'internal')
      response.end(JSON.stringify({ status: 1 }))
    })
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
})
beforeEach(() => {
  received.length = 0
})
afterAll(async () => {
  await new Promise((resolve) => upstream.close(resolve))
})

// What a browser sends from the guardian invitation page.
const browserHeaders = {
  'content-type': 'text/plain',
  accept: '*/*',
  referer:
    'https://couturecast.app/guardian/accept?token=eyJsecret&email=teen%40example.test',
  cookie: 'ph_phc_posthog=%7B%7D; sb-access-token=secret',
  'user-agent': 'Mozilla/5.0 (Macintosh)',
  'x-forwarded-for': '203.0.113.7',
  'x-real-ip': '203.0.113.7',
  origin: 'https://couturecast.app',
}

describe('U-ANALYTICS-PRIVACY-WEB-PROXY: the /ingest proxy', () => {
  it('forwards method, exact path and query, body and content type, and nothing else', async () => {
    const body = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x01])
    const response = await proxyPostHogIngest(
      new Request(
        'https://couturecast.app/ingest/e/?ip=0&ver=1.356.1&compression=gzip-js',
        {
          method: 'POST',
          headers: browserHeaders,
          body,
        }
      ),
      { api: origin, assets: 'http://assets.invalid' }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 1 })
    expect([...response.headers.keys()].sort()).toEqual(['cache-control', 'content-type'])
    const [forwarded] = received
    expect(forwarded).toMatchObject({
      method: 'POST',
      url: '/e/?ip=0&ver=1.356.1&compression=gzip-js',
    })
    expect(forwarded!.body.equals(body)).toBe(true)
    expect(forwarded!.headers).toMatchObject({
      'content-type': 'text/plain',
      accept: '*/*',
    })
    for (const name of ['referer', 'cookie', 'origin', 'x-forwarded-for', 'x-real-ip'])
      expect(forwarded!.headers).not.toHaveProperty(name)
    expect(JSON.stringify(forwarded!.headers)).not.toMatch(
      /eyJsecret|teen|Macintosh|203\.0/
    )
  })

  it('serves the exception autocapture script from the asset host, HEAD without a body', async () => {
    const scriptUrl =
      'https://couturecast.app/ingest/static/exception-autocapture.js?v=1.356.1'
    const upstreams = { api: 'http://api.invalid', assets: origin }
    const got = await proxyPostHogIngest(
      new Request(scriptUrl, { headers: browserHeaders }),
      upstreams
    )
    expect(got.status).toBe(200)
    const head = await proxyPostHogIngest(
      new Request(scriptUrl, { method: 'HEAD', headers: browserHeaders }),
      upstreams
    )
    expect(head.body).toBeNull()
    expect(received.map(({ method, url }) => [method, url])).toEqual([
      ['GET', '/static/exception-autocapture.js?v=1.356.1'],
      ['HEAD', '/static/exception-autocapture.js?v=1.356.1'],
    ])
  })

  it.each([
    ['POST', '/ingest/flags/?v=2'],
    ['POST', '/ingest/decide/'],
    ['GET', '/ingest/array/phc_project/config'],
    ['GET', '/ingest/static/logs.js?v=1.356.1'],
    ['GET', '/ingest/static/lazy-recorder.js'],
    ['POST', '/ingest/s/'],
    ['GET', '/ingest/e/'],
    ['POST', '/ingest/e/extra'],
  ])('answers 404 for %s %s without contacting PostHog', async (method, path) => {
    const response = await proxyPostHogIngest(
      new Request(`https://couturecast.app${path}`, {
        method,
        body: method === 'POST' ? '{}' : undefined,
      }),
      { api: origin, assets: origin }
    )
    expect(response.status).toBe(404)
    expect(received).toEqual([])
  })

  it('maps PostHog cloud hosts to their asset hosts and keeps a custom host', () => {
    expect(postHogUpstream('https://us.i.posthog.com')).toEqual({
      api: 'https://us.i.posthog.com',
      assets: 'https://us-assets.i.posthog.com',
    })
    expect(postHogUpstream('https://eu.i.posthog.com/')).toEqual({
      api: 'https://eu.i.posthog.com',
      assets: 'https://eu-assets.i.posthog.com',
    })
    expect(postHogUpstream('http://127.0.0.1:9000')).toEqual({
      api: 'http://127.0.0.1:9000',
      assets: 'http://127.0.0.1:9000',
    })
  })

  it('routes GET, HEAD and POST through the proxy to POSTHOG_HOST', async () => {
    const previous = process.env.POSTHOG_HOST
    process.env.POSTHOG_HOST = origin
    try {
      const script = 'https://couturecast.app/ingest/static/exception-autocapture.js'
      expect((await route.GET(new Request(script))).status).toBe(200)
      expect((await route.HEAD(new Request(script, { method: 'HEAD' }))).status).toBe(200)
      const post = await route.POST(
        new Request('https://couturecast.app/ingest/i/v0/e/', {
          method: 'POST',
          headers: browserHeaders,
          body: '{"event":"$pageview"}',
        })
      )
      expect(post.status).toBe(200)
      delete process.env.POSTHOG_HOST
      const fallback = await route.GET(
        new Request('https://couturecast.app/ingest/flags/')
      )
      expect(fallback.status).toBe(404)
    } finally {
      if (previous === undefined) delete process.env.POSTHOG_HOST
      else process.env.POSTHOG_HOST = previous
    }
    expect(received.map(({ method, url }) => [method, url])).toEqual([
      ['GET', '/static/exception-autocapture.js'],
      ['HEAD', '/static/exception-autocapture.js'],
      ['POST', '/i/v0/e/'],
    ])
    expect(received[2]!.headers).not.toHaveProperty('referer')
  })
})

/**
 * An upstream that stalls: it reads the request, then either withholds the response or
 * sends headers and part of the body and stops. `closed` resolves when the proxy drops
 * the upstream connection.
 */
async function stallingUpstream(mode: 'before-headers' | 'mid-body') {
  let markReceived = () => undefined as void
  let markClosed = () => undefined as void
  const requestReceived = new Promise<void>((resolve) => (markReceived = resolve))
  const closed = new Promise<void>((resolve) => (markClosed = resolve))
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      markReceived()
      if (mode === 'mid-body') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' })
        response.write('/* partial')
      }
    })
    response.on('close', () => markClosed())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    upstream: { api: address, assets: address },
    requestReceived,
    closed,
    stop: () => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    },
  }
}
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms)
    ),
  ])
const eventRequest = (init: RequestInit = {}) =>
  new Request('https://couturecast.app/ingest/e/?compression=gzip-js', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{"event":"$pageview"}',
    ...init,
  })

describe('U-ANALYTICS-PRIVACY-WEB-PROXY: bounded upstream work', () => {
  it('drops the upstream request when the browser leaves before PostHog answers', async () => {
    const stall = await stallingUpstream('before-headers')
    try {
      const client = new AbortController()
      const proxied = proxyPostHogIngest(
        eventRequest({ signal: client.signal }),
        stall.upstream
      )
      await within(stall.requestReceived, 2_000)
      client.abort()
      await within(stall.closed, 2_000)
      expect((await within(proxied, 2_000)).status).toBe(504)
    } finally {
      await stall.stop()
    }
  })

  it('answers 504 and closes the upstream connection when PostHog misses the deadline', async () => {
    const stall = await stallingUpstream('before-headers')
    try {
      const started = Date.now()
      const response = await within(
        proxyPostHogIngest(eventRequest(), stall.upstream, { deadlineMs: 200 }),
        2_000
      )
      expect(response.status).toBe(504)
      expect(Date.now() - started).toBeLessThan(1_500)
      await within(stall.closed, 2_000)
    } finally {
      await stall.stop()
    }
  })

  it('keeps the deadline while the response body streams', async () => {
    const stall = await stallingUpstream('mid-body')
    try {
      const response = await within(
        proxyPostHogIngest(
          new Request('https://couturecast.app/ingest/static/exception-autocapture.js'),
          stall.upstream,
          { deadlineMs: 300 }
        ),
        2_000
      )
      expect(response.status).toBe(200)
      await expect(within(response.text(), 2_000)).rejects.toThrow()
      await within(stall.closed, 2_000)
    } finally {
      await stall.stop()
    }
  })

  it('answers 413 for a body over the cap without contacting PostHog', async () => {
    const big = new Uint8Array(1024 * 1024 + 1)
    const declared = await proxyPostHogIngest(eventRequest({ body: big }), {
      api: origin,
      assets: origin,
    })
    expect(declared.status).toBe(413)
    // A streamed body with no Content-Length is counted as it arrives.
    const streamed = await proxyPostHogIngest(
      eventRequest({
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(big.subarray(0, 600_000))
            controller.enqueue(big.subarray(600_000))
            controller.close()
          },
        }),
        duplex: 'half',
      } as RequestInit),
      { api: origin, assets: origin }
    )
    expect(streamed.status).toBe(413)
    expect(received).toEqual([])
  })

  it('refuses a declared Content-Length over the cap before reading the body', async () => {
    const response = await proxyPostHogIngest(
      eventRequest({
        headers: {
          'content-type': 'text/plain',
          'content-length': String(2 * 1024 * 1024),
        },
        body: '{}',
      }),
      { api: origin, assets: origin }
    )
    expect(response.status).toBe(413)
    expect(received).toEqual([])
  })

  it('stops reading an upload the browser abandons and answers 504', async () => {
    const client = new AbortController()
    const proxied = proxyPostHogIngest(
      eventRequest({
        signal: client.signal,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"event":'))
          },
        }),
        duplex: 'half',
      } as RequestInit),
      { api: origin, assets: origin }
    )
    setTimeout(() => client.abort(), 50)
    expect((await within(proxied, 2_000)).status).toBe(504)
    expect(received).toEqual([])
  })

  it('answers 504 at once for a request the browser already left, its upload still open', async () => {
    const client = new AbortController()
    client.abort()
    let cancelled = false
    const proxied = proxyPostHogIngest(
      eventRequest({
        signal: client.signal,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"event":'))
          },
          cancel() {
            cancelled = true
          },
        }),
        duplex: 'half',
      } as RequestInit),
      { api: origin, assets: origin }
    )
    const response = await within(proxied, 1_000)
    expect(response.status).toBe(504)
    expect(await response.text()).toBe('')
    expect(cancelled).toBe(true)
    expect(received).toEqual([])
  })

  it('forwards an empty event body and answers 502 when PostHog cannot be reached', async () => {
    const empty = await proxyPostHogIngest(eventRequest({ body: null }), {
      api: origin,
      assets: origin,
    })
    expect(empty.status).toBe(200)
    expect(received[0]?.body.byteLength).toBe(0)
    const port = await new Promise<number>((resolve) => {
      const probe = createServer()
      probe.listen(0, '127.0.0.1', () => {
        const { port: free } = probe.address() as AddressInfo
        probe.close(() => resolve(free))
      })
    })
    const unreachable = await proxyPostHogIngest(eventRequest(), {
      api: `http://127.0.0.1:${port}`,
      assets: `http://127.0.0.1:${port}`,
    })
    expect(unreachable.status).toBe(502)
  })

  it('sets a route time budget as the platform backstop', () => {
    expect(route.maxDuration).toBeGreaterThan(0)
    expect(route.maxDuration).toBeLessThanOrEqual(15)
  })
})
