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
