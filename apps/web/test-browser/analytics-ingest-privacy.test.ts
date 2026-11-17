import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * U-ANALYTICS-PRIVACY-WEB-TRANSPORT: the real web app (next dev, production analytics
 * init) in real Chromium, with PostHog replaced by a local receiver. A guardian opens
 * the invitation link; nothing the receiver gets (request line, any header, decoded
 * body) may carry the invitation token, the email or the fragment. No database: the
 * page renders without the API, and analytics needs none.
 */

const webRoot = path.resolve(__dirname, '..')
// Uploaded by the PR checks job when this check fails: next dev's output and what the
// page saw, so a failure explains itself.
const evidenceDir = path.resolve(webRoot, '../../playwright/artifacts/analytics-privacy')
const nextDevLog = path.join(evidenceDir, 'next-dev.log')
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
const startedAt = Date.now()
/** What the page did, in order: requests, responses, console lines, errors. */
const pageEvents: string[] = []

/** The evidence with every leak masked, so a failure message never carries the token. */
function redact(text: string): string {
  return leaks.reduce((masked, leak) => masked.split(leak).join('[redacted]'), text)
}

function nextDevTail(lines = 80): string {
  try {
    return readFileSync(nextDevLog, 'utf8').split('\n').slice(-lines).join('\n')
  } catch (error) {
    return `(next dev log unreadable: ${(error as Error).message})`
  }
}

/** Everything known when a wait times out, also written to the evidence directory. */
function evidence(): string {
  const text = redact(
    [
      `receiver got: ${received.map(({ method, url }) => `${method} ${url}`).join(', ') || '(nothing)'}`,
      `page events (${pageEvents.length}):`,
      ...pageEvents.map((line) => `  ${line}`),
      'next dev output, last lines:',
      nextDevTail(),
    ].join('\n')
  )
  try {
    writeFileSync(path.join(evidenceDir, 'evidence.txt'), `${text}\n`)
  } catch {
    // The message below still carries it.
  }
  return text
}

async function recordPage(page: Page) {
  const at = () => `+${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  page.on('request', (request) =>
    pageEvents.push(`${at()} request ${request.method()} ${request.url()}`)
  )
  page.on('response', (response) =>
    pageEvents.push(`${at()} response ${response.status()} ${response.url()}`)
  )
  page.on('requestfailed', (request) =>
    pageEvents.push(
      `${at()} requestfailed ${request.method()} ${request.url()}: ${request.failure()?.errorText ?? ''}`
    )
  )
  page.on('console', (message) =>
    pageEvents.push(`${at()} console.${message.type()} ${message.text()}`)
  )
  page.on('pageerror', (error) =>
    pageEvents.push(`${at()} pageerror ${error.message} ${error.stack ?? ''}`.trimEnd())
  )
  // A script that fails to parse raises a pageerror with no message or stack; the
  // debugger names it.
  const session = await page.context().newCDPSession(page)
  session.on('Debugger.scriptFailedToParse', ({ url, startLine, length, hash }) =>
    pageEvents.push(
      `${at()} scriptFailedToParse ${url || '(inline)'} line ${startLine} length ${length} hash ${hash}`
    )
  )
  await session.send('Debugger.enable')
}

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
      throw new Error(`timed out after ${timeoutMs} ms\n${evidence()}`)
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
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(nextDevLog, '')
  web = spawn(
    process.execPath,
    [requireFromWeb.resolve('next/dist/bin/next'), 'dev', '-p', String(port)],
    {
      cwd: webRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
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
  // next dev logs each request line, the invitation URL included, so the file gets
  // every line redacted.
  for (const stream of [web.stdout, web.stderr])
    if (stream)
      createInterface({ input: stream }).on('line', (line) =>
        appendFileSync(nextDevLog, `${redact(line)}\n`)
      )
  await waitFor(async () => {
    const response = await fetch(`${webOrigin}/api/health`)
    return response.ok ? true : undefined
  }, 120_000)
  browser = await chromium.launch({ headless: true })
  await warmNextDev()
}, 180_000)

/**
 * The first visit to a page under next dev compiles it, and the server compile then sends
 * the client compiler around again ("Compiled in ... (486 modules)"), re-emitting the
 * page's chunks while the browser is still fetching them. About half of all cold visits
 * got app/layout.js cut off at a 64 KiB write boundary (Invalid or unexpected token), and
 * PR checks run 44131052026 saw a visit in which PostHog sent nothing for 60 s. One
 * throwaway visit to the same page, with no token and /ingest blocked so nothing reaches
 * the receiver, lets every compile finish first; the /ingest route compiles on a path it
 * answers 404 without calling PostHog.
 */
async function warmNextDev() {
  const context = await browser.newContext()
  try {
    await context.route('**/ingest/**', (route) => route.abort())
    const page = await context.newPage()
    await page.goto(`${webOrigin}/guardian/accept`)
    await page.waitForLoadState('networkidle')
  } finally {
    await context.close()
  }
  const ingest = await fetch(`${webOrigin}/ingest/warm-up`)
  expect(ingest.status).toBe(404)
  expect(received).toEqual([])
}

afterAll(async () => {
  await browser?.close()
  if (web?.pid) process.kill(-web.pid, 'SIGTERM')
  await new Promise((resolve) => upstream?.close(resolve))
})

type SentEvent = { event?: unknown; properties?: Record<string, unknown> }

/** The events in one capture body: a single event, an array, or a `{ batch }` envelope. */
function eventsOf(body: string): SentEvent[] {
  const parsed: unknown = JSON.parse(body)
  const list = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === 'object' && 'batch' in parsed
      ? (parsed as { batch: unknown }).batch
      : [parsed]
  return Array.isArray(list) ? (list as SentEvent[]) : []
}

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
    await recordPage(page)
    try {
      const document = await page.goto(`${webOrigin}${invitationPath}`)
      // next dev must hand the page whole chunks: one cut off mid-write leaves the app
      // half booted, and PostHog may never start.
      await page.waitForLoadState('networkidle')
      if (pageEvents.some((line) => line.includes('scriptFailedToParse')))
        throw new Error(`next dev served a script that does not parse\n${evidence()}`)
      // The uncaught error goes through exception autocapture, which loads its script and
      // only then wraps window.onerror; an error thrown before that is never captured.
      await waitFor(
        () =>
          page.evaluate(() =>
            (window.onerror as { __POSTHOG_INSTRUMENTED__?: boolean } | null)
              ?.__POSTHOG_INSTRUMENTED__
              ? true
              : undefined
          ),
        30_000
      )
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
      // One body can carry several events (a /batch holds the pageview and the exception
      // together), so each assertion reads the pageview event itself.
      const pageview = received
        .filter(isEvent)
        .flatMap(({ body }) => eventsOf(body))
        .find((event) => event.event === '$pageview')
      expect(pageview?.properties?.$current_url).toContain('/guardian/accept')
      // The event tells PostHog to add no location and sends no IP of its own.
      expect(pageview?.properties).toMatchObject({ $geoip_disable: true, $ip: null })
      // The exception script came through the same proxy, from the same receiver.
      expect(
        received.some(({ url }) => url.startsWith('/static/exception-autocapture.js'))
      ).toBe(true)
    } finally {
      await context.close()
    }
  }, 120_000)
})
