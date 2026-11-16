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

/** A route for `url` whose fetch answers `answer`, or throws `failure`. */
function route(url: string, answer: Answer | Error, method = 'GET') {
  const calls = {
    fetch: [] as unknown[],
    fulfill: [] as unknown[],
    continue: 0,
    fallback: 0,
  }
  const fake = {
    request: () => ({ url: () => url, method: () => method }),
    fetch: vi.fn((options: unknown) => {
      calls.fetch.push(options)
      if (answer instanceof Error) return Promise.reject(answer)
      return Promise.resolve({
        status: () => answer.status,
        headers: () => answer.headers,
        body: () => Promise.resolve(Buffer.from(answer.body)),
      })
    }),
    fulfill: vi.fn((reply: unknown) => {
      calls.fulfill.push(reply)
      return Promise.resolve()
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
