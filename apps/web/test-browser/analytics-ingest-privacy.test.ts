import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * U-ANALYTICS-PRIVACY-WEB-TRANSPORT: the real web app (next dev, production analytics
 * init) in real Chromium, with PostHog replaced by a local receiver. A guardian opens
 * the invitation link; nothing the receiver gets (request line, any header, decoded
 * body) may carry the invitation token, the email or the fragment. No database: the
 * page renders without the API, and analytics needs none.
 */

const webRoot = path.resolve(__dirname, '..')
const requireFromWeb = createRequire(path.join(webRoot, 'package.json'))
// A guardian invitation token as the API issues it: a JWT whose payload names the teen
// and the guardian's email.
const invitationToken =
  'eyJhbGciOiJIUzI1NiJ9.eyJ0ZWVuSWQiOiJ0ZWVuLTEiLCJndWFyZGlhbkVtYWlsIjoiZ0BleC50ZXN0In0.c2lnbmF0dXJl'
const invitationPath = `/guardian/accept?token=${invitationToken}&email=teen%40example.test#frag-teen`
const leaks = [
  invitationToken,
  'eyJ',
  'teen@example.test',
  'teen%40example.test',
  'teen%2540example.test',
  'frag-teen',
  'token=',
]

type Received = {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
}
const received: Received[] = []
let upstream: Server
let web: ChildProcess
let webOrigin = ''
let browser: Browser

function decodeBody(url: string, raw: Buffer): string {
  if (raw.length === 0) return ''
  if (url.includes('compression=gzip-js') || (raw[0] === 0x1f && raw[1] === 0x8b)) {
    try {
      return gunzipSync(raw).toString('utf8')
    } catch {
      // Not gzip after all; fall through to text.
    }
  }
  const text = raw.toString('utf8')
  return text.startsWith('data=')
    ? Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString('utf8')
    : text
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe().catch(() => undefined)
    if (value !== undefined) return value
    if (Date.now() > deadline)
      throw new Error(
        `timed out; the receiver got ${received.map(({ method, url }) => `${method} ${url}`).join(', ')}`
      )
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const exceptionAutocaptureScript = readFileSync(
  path.join(
    path.dirname(requireFromWeb.resolve('posthog-js')),
    'exception-autocapture.js'
  )
)

beforeAll(async () => {
  upstream = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const url = request.url ?? ''
      received.push({
        method: request.method ?? '',
        url,
        headers: request.headers,
        body: decodeBody(url, Buffer.concat(chunks)),
      })
      if (url.startsWith('/static/')) {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(exceptionAutocaptureScript)
        return
      }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ status: 1 }))
    })
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamOrigin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`

  const port = await freePort()
  webOrigin = `http://127.0.0.1:${port}`
  web = spawn(
    process.execPath,
    [requireFromWeb.resolve('next/dist/bin/next'), 'dev', '-p', String(port)],
    {
      cwd: webRoot,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        WEB_NEXT_DIST_DIR: '.next-analytics-privacy',
        POSTHOG_API_KEY: 'phc_analytics_privacy_test',
        POSTHOG_HOST: upstreamOrigin,
      },
    }
  )
  await waitFor(async () => {
    const response = await fetch(`${webOrigin}/api/health`)
    return response.ok ? true : undefined
  }, 120_000)
  browser = await chromium.launch({ headless: true })
}, 180_000)

afterAll(async () => {
  await browser?.close()
  if (web?.pid) process.kill(-web.pid, 'SIGTERM')
  await new Promise((resolve) => upstream?.close(resolve))
})

describe('U-ANALYTICS-PRIVACY-WEB-TRANSPORT: what PostHog receives', () => {
  it('a guardian opening the invitation link sends no token, email or fragment in any request', async () => {
    const context = await browser.newContext({
      // posthog-js treats automation and headless user agents as bots and sends nothing,
      // so the page presents as an ordinary visitor.
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      // Headless Chromium names itself in its client hints brands.
      Object.defineProperty(navigator, 'userAgentData', { get: () => undefined })
    })
    const page = await context.newPage()
    try {
      const document = await page.goto(`${webOrigin}${invitationPath}`)
      // The uncaught error goes through exception autocapture, which loads its script.
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error('autocaptured')
        }, 10)
      })
      // The same event paths the ingest proxy forwards, /batch included.
      const isEvent = ({ method, url }: Received) =>
        method === 'POST' && /^\/(?:e|i\/v0\/e|batch)\/?(?:\?|$)/.test(url)
      await waitFor(() => {
        const events = received
          .filter(isEvent)
          .map(({ body }) => body)
          .join('\n')
        return Promise.resolve(
          events.includes('$pageview') && events.includes('$exception') ? true : undefined
        )
      }, 60_000)
      for (const request of received) {
        const where = `${request.method} ${request.url}`
        if (request.headers.referer !== undefined)
          expect(request.headers.referer, where).not.toContain('/guardian')
        expect(request.headers, where).not.toHaveProperty('cookie')
        const serialized = JSON.stringify(request)
        for (const leak of leaks) expect(serialized, where).not.toContain(leak)
      }
      // The document itself tells the browser to send the origin only as Referer.
      expect(document?.headers()['referrer-policy']).toBe('strict-origin')
      const pageview = received.find(
        (request) => isEvent(request) && request.body.includes('$pageview')
      )
      expect(pageview?.body).toContain('/guardian/accept')
      // PostHog is told to add no location and keep no IP for the event.
      expect(pageview?.body).toMatch(/"\$geoip_disable":\s*true/)
      expect(pageview?.body).toMatch(/"\$ip":\s*null/)
      // The exception script came through the same proxy, from the same receiver.
      expect(
        received.some(({ url }) => url.startsWith('/static/exception-autocapture.js'))
      ).toBe(true)
    } finally {
      await context.close()
    }
  }, 120_000)
})
