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

/**
 * Failures that only mean the test ended mid-request: its context closed, or its route was sent
 * on. Nobody is waiting for that answer. Any other failure is real.
 */
const TEARDOWN =
  /Request context disposed|Response has been disposed|Target page, context or browser has been closed|Route is already handled/

function endedByTeardown(error: unknown): boolean {
  return error instanceof Error && TEARDOWN.test(error.message)
}

async function unlessTornDown(step: () => Promise<void>): Promise<void> {
  try {
    await step()
  } catch (error) {
    if (!endedByTeardown(error)) throw error
  }
}

export type ImmutableAssetCache = {
  /** Serves a kept asset, or fetches it and keeps it when the server marks it immutable. */
  handle: (route: Route) => Promise<void>
  /** Routes the context's immutable asset requests through `handle`. */
  attach: (context: BrowserContext) => Promise<void>
  /**
   * Lets every request in flight finish, then takes the route away; call before the context
   * closes. Closing first disposes a fetch still running, and Playwright records a failed step
   * whose call log lists the request headers, the preview's `_vercel_jwt` bypass cookie among
   * them (see drainApiProxy in browser-api-proxy.ts).
   */
  detach: (context: BrowserContext) => Promise<void>
  /** How many requests reached the server and how many were served from the cache. */
  stats: () => { fetched: number; served: number; kept: number }
}

type Fetched = { reply: KeptResponse; keep: boolean }

export function createImmutableAssetCache(): ImmutableAssetCache {
  const kept = new Map<string, KeptResponse>()
  /** A fetch still running per URL, so a second request for it waits instead of fetching. */
  const pending = new Map<string, Promise<KeptResponse | undefined>>()
  const inFlight = new Set<Promise<void>>()
  let fetched = 0
  let served = 0

  /** The server's answer, or undefined when the browser was left to make the request. */
  async function fetchReply(route: Route): Promise<Fetched | undefined> {
    let response: Awaited<ReturnType<Route['fetch']>>
    try {
      // A redirect reaches the browser as one, as it would without the cache.
      response = await route.fetch({ maxRedirects: 0 })
    } catch {
      // Let the browser make the request itself, so a network failure reaches the page as it
      // would without the cache. A route whose page already closed has nothing to answer.
      await route.continue().catch(() => undefined)
      return undefined
    }
    fetched += 1
    let body: Buffer
    try {
      body = await response.body()
    } catch (error) {
      if (endedByTeardown(error)) return undefined
      throw error
    }
    const reply = {
      status: response.status(),
      headers: withoutWireHeaders(response.headers()),
      body,
    }
    return { reply, keep: reply.status === 200 && isImmutable(response.headers()) }
  }

  async function serve(route: Route): Promise<void> {
    const request = route.request()
    if (request.method() !== 'GET') return route.fallback()
    const url = request.url()
    // Read the running fetch before any await, so a second request cannot miss it.
    const running = pending.get(url)
    const hit = kept.get(url) ?? (running && (await running))
    if (hit) {
      served += 1
      return unlessTornDown(() => route.fulfill(hit))
    }
    const fetching = fetchReply(route)
    const shared = fetching.then(
      (result) => (result?.keep ? result.reply : undefined),
      () => undefined
    )
    pending.set(url, shared)
    let result: Fetched | undefined
    try {
      result = await fetching
    } finally {
      if (pending.get(url) === shared) pending.delete(url)
    }
    if (!result) return
    if (result.keep) kept.set(url, result.reply)
    const { reply } = result
    return unlessTornDown(() => route.fulfill(reply))
  }

  function handle(route: Route): Promise<void> {
    const work = serve(route)
    inFlight.add(work)
    return work.finally(() => inFlight.delete(work))
  }

  async function drain(): Promise<void> {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight])
  }

  return {
    handle,
    attach: async (context) => {
      await context.route(IMMUTABLE_ASSET_PATTERN, handle)
    },
    detach: async (context) => {
      // Drain first: taking the route away sends a route still running on to the network, and
      // its fetch then finds the route handled. A request that started meanwhile drains after.
      await drain()
      await unlessTornDown(() => context.unroute(IMMUTABLE_ASSET_PATTERN, handle))
      await drain()
    },
    stats: () => ({ fetched, served, kept: kept.size }),
  }
}
