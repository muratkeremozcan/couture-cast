// Which responses the worker's asset cache keeps and how it replays them. The real-browser
// proof is the preview and production E2E runs, whose page loads go through it.
import type { BrowserContext, Route } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import {
  createImmutableAssetCache,
  IMMUTABLE_ASSET_PATTERN,
  isImmutable,
  withoutWireHeaders,
} from './immutable-asset-cache'

const ASSET = 'https://web.example/_next/static/chunks/main-abc123.js'
const IMMUTABLE = 'public,max-age=31536000,immutable'

type Answer = { status: number; headers: Record<string, string>; body: string }

type RouteControls = {
  /** Holds the fetch until it settles. */
  gate?: Promise<void>
  /** What reading the body throws. */
  bodyError?: Error
  /** What fulfilling throws. */
  fulfillError?: Error
  /** Every call in order, shared across routes and the context. */
  log?: string[]
}

/** A route for `url` whose fetch answers `answer`, or throws `failure`. */
function route(
  url: string,
  answer: Answer | Error,
  method = 'GET',
  controls: RouteControls = {}
) {
  const calls = {
    fetch: [] as unknown[],
    fulfill: [] as unknown[],
    continue: 0,
    fallback: 0,
  }
  const fake = {
    request: () => ({ url: () => url, method: () => method }),
    fetch: vi.fn(async (options: unknown) => {
      calls.fetch.push(options)
      controls.log?.push('fetch')
      await controls.gate
      if (answer instanceof Error) throw answer
      return {
        status: () => answer.status,
        headers: () => answer.headers,
        body: () =>
          controls.bodyError
            ? Promise.reject(controls.bodyError)
            : Promise.resolve(Buffer.from(answer.body)),
      }
    }),
    fulfill: vi.fn((reply: unknown) => {
      calls.fulfill.push(reply)
      controls.log?.push('fulfill')
      return controls.fulfillError
        ? Promise.reject(controls.fulfillError)
        : Promise.resolve()
    }),
    continue: vi.fn(() => {
      calls.continue += 1
      return Promise.resolve()
    }),
    fallback: vi.fn(() => {
      calls.fallback += 1
      return Promise.resolve()
    }),
  }
  return { route: fake as unknown as Route, calls }
}

const immutable = (body: string): Answer => ({
  status: 200,
  headers: {
    'cache-control': IMMUTABLE,
    'content-type': 'application/javascript; charset=utf-8',
    'content-encoding': 'br',
    'content-length': '12',
  },
  body,
})

describe('isImmutable', () => {
  it.each([
    [IMMUTABLE, true],
    ['public, max-age=31536000, Immutable', true],
    ['public, max-age=0, must-revalidate', false],
    ['no-store, must-revalidate', false],
    ['public, max-age=31536000, immutable-ish', false],
  ])('reads Cache-Control %j as %s', (value, expected) => {
    expect(isImmutable({ 'cache-control': value })).toBe(expected)
  })

  it('treats a response without Cache-Control as revalidated', () => {
    expect(isImmutable({})).toBe(false)
  })
})

describe('withoutWireHeaders', () => {
  it('drops the encoding and length of the bytes on the wire and keeps the rest', () => {
    expect(
      withoutWireHeaders({
        'content-type': 'text/css',
        'Content-Encoding': 'gzip',
        'content-length': '10',
        'transfer-encoding': 'chunked',
        etag: '"v1"',
      })
    ).toEqual({ 'content-type': 'text/css', etag: '"v1"' })
  })
})

describe('createImmutableAssetCache', () => {
  it('fetches an immutable asset once per worker and replays it, decoded, afterwards', async () => {
    const cache = createImmutableAssetCache()
    const first = route(ASSET, immutable('console.log(1)'))
    await cache.handle(first.route)
    const second = route(ASSET, immutable('never fetched'))
    await cache.handle(second.route)

    const replay = {
      status: 200,
      headers: {
        'cache-control': IMMUTABLE,
        'content-type': 'application/javascript; charset=utf-8',
      },
      body: Buffer.from('console.log(1)'),
    }
    expect(first.calls.fetch).toEqual([{ maxRedirects: 0 }])
    expect(first.calls.fulfill).toEqual([replay])
    expect(second.calls.fetch).toEqual([])
    expect(second.calls.fulfill).toEqual([replay])
    expect(cache.stats()).toEqual({ fetched: 1, served: 1, kept: 1 })
  })

  it.each([
    [
      'a revalidated response',
      { status: 200, headers: { 'cache-control': 'no-store' }, body: 'dev chunk' },
    ],
    [
      'a missing asset',
      { status: 404, headers: { 'cache-control': IMMUTABLE }, body: 'not found' },
    ],
    [
      'a redirect',
      {
        status: 307,
        headers: { 'cache-control': IMMUTABLE, location: '/login' },
        body: '',
      },
    ],
  ])('passes %s through and asks the server again next time', async (_label, answer) => {
    const cache = createImmutableAssetCache()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const next = route(ASSET, answer)
      await cache.handle(next.route)
      expect(next.calls.fetch).toEqual([{ maxRedirects: 0 }])
      expect(next.calls.fulfill).toEqual([
        {
          status: answer.status,
          headers: answer.headers,
          body: Buffer.from(answer.body),
        },
      ])
    }
    expect(cache.stats()).toEqual({ fetched: 2, served: 0, kept: 0 })
  })

  it('keeps each URL apart, so another deployment or build fetches its own asset', async () => {
    const cache = createImmutableAssetCache()
    await cache.handle(route(ASSET, immutable('a')).route)
    const other = route(
      'https://other.example/_next/static/chunks/main-abc123.js',
      immutable('b')
    )
    await cache.handle(other.route)
    expect(other.calls.fetch).toEqual([{ maxRedirects: 0 }])
    expect(cache.stats()).toEqual({ fetched: 2, served: 0, kept: 2 })
  })

  it('lets the browser make a request whose fetch failed, so the page sees the failure', async () => {
    const cache = createImmutableAssetCache()
    const failed = route(ASSET, new Error('net::ERR_CONNECTION_RESET'))
    await cache.handle(failed.route)
    expect(failed.calls.continue).toBe(1)
    expect(failed.calls.fulfill).toEqual([])
    expect(cache.stats()).toEqual({ fetched: 0, served: 0, kept: 0 })
  })

  it('leaves a request other than GET to the next route', async () => {
    const cache = createImmutableAssetCache()
    const posted = route(ASSET, immutable('a'), 'POST')
    await cache.handle(posted.route)
    expect(posted.calls.fallback).toBe(1)
    expect(posted.calls.fetch).toEqual([])
  })

  it('fetches an asset requested twice at once a single time and serves both', async () => {
    const cache = createImmutableAssetCache()
    let release = () => undefined as void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const first = route(ASSET, immutable('shared'), 'GET', { gate })
    const second = route(ASSET, immutable('never fetched'), 'GET', { gate })
    const both = Promise.all([cache.handle(first.route), cache.handle(second.route)])
    release()
    await both
    const replay = {
      status: 200,
      headers: {
        'cache-control': IMMUTABLE,
        'content-type': 'application/javascript; charset=utf-8',
      },
      body: Buffer.from('shared'),
    }
    expect(first.calls.fetch).toEqual([{ maxRedirects: 0 }])
    expect(second.calls.fetch).toEqual([])
    expect(first.calls.fulfill).toEqual([replay])
    expect(second.calls.fulfill).toEqual([replay])
    expect(cache.stats()).toEqual({ fetched: 1, served: 1, kept: 1 })
  })

  it('lets a request waiting on an answer it may not keep fetch its own', async () => {
    const cache = createImmutableAssetCache()
    let release = () => undefined as void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const missing = { status: 404, headers: { 'cache-control': IMMUTABLE }, body: 'gone' }
    const first = route(ASSET, missing, 'GET', { gate })
    const second = route(ASSET, immutable('now here'), 'GET')
    const both = Promise.all([cache.handle(first.route), cache.handle(second.route)])
    release()
    await both
    expect(first.calls.fetch).toEqual([{ maxRedirects: 0 }])
    expect(second.calls.fetch).toEqual([{ maxRedirects: 0 }])
    expect(second.calls.fulfill).toEqual([
      {
        status: 200,
        headers: {
          'cache-control': IMMUTABLE,
          'content-type': 'application/javascript; charset=utf-8',
        },
        body: Buffer.from('now here'),
      },
    ])
    expect(cache.stats()).toEqual({ fetched: 2, served: 0, kept: 1 })
  })

  it('detach waits for every request in flight before it unroutes, so none outlives the context', async () => {
    const cache = createImmutableAssetCache()
    const log: string[] = []
    const context = {
      route: vi.fn(() => Promise.resolve()),
      unroute: vi.fn(() => {
        log.push('unroute')
        return Promise.resolve()
      }),
    }
    await cache.attach(context as unknown as BrowserContext)
    let release = () => undefined as void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow = route(ASSET, immutable('late chunk'), 'GET', { gate, log })
    const handling = cache.handle(slow.route)
    let detached = false
    const detaching = cache
      .detach(context as unknown as BrowserContext)
      .then(() => (detached = true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(detached).toBe(false)
    expect(log).toEqual(['fetch'])
    release()
    await Promise.all([handling, detaching])
    expect(log).toEqual(['fetch', 'fulfill', 'unroute'])
    expect(context.unroute).toHaveBeenCalledExactlyOnceWith(
      '**/_next/static/**',
      cache.handle
    )
  })

  it.each([
    [
      'the body',
      { bodyError: new Error('apiResponse.body: Response has been disposed') },
    ],
    [
      'the fulfill',
      {
        fulfillError: new Error(
          'route.fulfill: Target page, context or browser has been closed'
        ),
      },
    ],
    [
      'the fulfill',
      { fulfillError: new Error('route.fulfill: Route is already handled!') },
    ],
  ])('ends quietly when teardown disposes %s', async (_label, controls) => {
    const cache = createImmutableAssetCache()
    await expect(
      cache.handle(route(ASSET, immutable('a'), 'GET', controls).route)
    ).resolves.toBeUndefined()
  })

  // CodeRabbit review of #243: a body that cannot be read leaves the request to the browser,
  // as a failed fetch does, so the page meets the network as it would without the cache.
  it.each(['read ECONNRESET', 'apiResponse.body: Response has been disposed'])(
    'lets the browser make a request whose body read failed (%s)',
    async (message) => {
      const cache = createImmutableAssetCache()
      const broken = route(ASSET, immutable('a'), 'GET', {
        bodyError: new Error(message),
      })
      await expect(cache.handle(broken.route)).resolves.toBeUndefined()
      expect(broken.calls.continue).toBe(1)
      expect(broken.calls.fulfill).toEqual([])
      expect(cache.stats()).toEqual({ fetched: 1, served: 0, kept: 0 })
    }
  )

  it('still fails on any other error fulfilling', async () => {
    const cache = createImmutableAssetCache()
    await expect(
      cache.handle(
        route(ASSET, immutable('b'), 'GET', {
          fulfillError: new Error('route.fulfill: invalid headers'),
        }).route
      )
    ).rejects.toThrow('route.fulfill: invalid headers')
  })

  it('routes only Next.js build output through the cache', async () => {
    const cache = createImmutableAssetCache()
    const context = { route: vi.fn(() => Promise.resolve()) }
    await cache.attach(context as unknown as BrowserContext)
    expect(IMMUTABLE_ASSET_PATTERN).toBe('**/_next/static/**')
    expect(context.route).toHaveBeenCalledExactlyOnceWith(
      '**/_next/static/**',
      cache.handle
    )
  })
})
