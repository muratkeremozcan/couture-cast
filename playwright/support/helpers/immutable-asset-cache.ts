// Keeps the web app's immutable build assets for the rest of a Playwright worker, the way a
// returning browser keeps them in its HTTP cache. Every test opens a fresh context, and any
// route a test registers turns Chromium's HTTP cache off, so each page load fetched all ~23
// hashed chunks, fonts and stylesheets again. Against Vercel those requests were 94% of the
// team's 30-day edge requests (769,717 on 2026-11-16, of a 1,000,000 Hobby limit), nearly all
// from preview and production E2E runs.
//
// Only a 200 GET the server marks `immutable` is kept, so a dev server's assets (no-store) and
// every page, RSC payload and API call still reach the server on every request. The first
// request for each asset in a worker always does, so a deployment that cannot serve one still
// fails the test that asks for it.
import type { BrowserContext, Route } from '@playwright/test'

/** Where Next.js serves content-hashed build output. */
export const IMMUTABLE_ASSET_PATTERN = '**/_next/static/**'

type KeptResponse = {
  status: number
  headers: Record<string, string>
  body: Buffer
}

/**
 * Headers that describe the bytes on the wire. `route.fetch()` hands back the decoded body,
 * so replaying them would make the browser decode it twice.
 */
const WIRE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding'])

/** Whether a response's Cache-Control lets a browser keep it without revalidating. */
export function isImmutable(headers: Record<string, string>): boolean {
  return (headers['cache-control'] ?? '')
    .split(',')
    .some((directive) => directive.trim().toLowerCase() === 'immutable')
}

export function withoutWireHeaders(
  headers: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !WIRE_HEADERS.has(name.toLowerCase()))
  )
}

export type ImmutableAssetCache = {
  /** Serves a kept asset, or fetches it and keeps it when the server marks it immutable. */
  handle: (route: Route) => Promise<void>
  /** Routes the context's immutable asset requests through `handle`. */
  attach: (context: BrowserContext) => Promise<void>
  /** How many requests reached the server and how many were served from the cache. */
  stats: () => { fetched: number; served: number; kept: number }
}

export function createImmutableAssetCache(): ImmutableAssetCache {
  const kept = new Map<string, KeptResponse>()
  let fetched = 0
  let served = 0

  async function handle(route: Route): Promise<void> {
    const request = route.request()
    if (request.method() !== 'GET') return route.fallback()
    const url = request.url()
    const hit = kept.get(url)
    if (hit) {
      served += 1
      return route.fulfill(hit)
    }
    let response: Awaited<ReturnType<Route['fetch']>>
    try {
      // A redirect reaches the browser as one, as it would without the cache.
      response = await route.fetch({ maxRedirects: 0 })
    } catch {
      // Let the browser make the request itself, so a network failure reaches the page as it
      // would without the cache. A route whose page already closed has nothing to answer.
      await route.continue().catch(() => undefined)
      return
    }
    fetched += 1
    const reply: KeptResponse = {
      status: response.status(),
      headers: withoutWireHeaders(response.headers()),
      body: await response.body(),
    }
    if (reply.status === 200 && isImmutable(response.headers())) kept.set(url, reply)
    return route.fulfill(reply)
  }

  return {
    handle,
    attach: async (context) => {
      await context.route(IMMUTABLE_ASSET_PATTERN, handle)
    },
    stats: () => ({ fetched, served, kept: kept.size }),
  }
}
