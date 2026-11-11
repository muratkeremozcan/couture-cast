/**
 * The same-origin /ingest proxy between posthog-js and PostHog.
 *
 * Production analytics privacy: a plain rewrite forwards every browser request header,
 * so the Referer of a guardian invitation page (its token and the guardian's email)
 * and the site cookies reached PostHog. This proxy forwards only what PostHog needs to
 * ingest an event: the method, the exact path and query, the body and its content
 * type. Referer, Cookie, the client IP and every other header stay on our origin, and
 * only the event endpoints and the exception autocapture script are proxied at all;
 * every other path answers 404.
 */

/** Request headers PostHog needs; every other header stays on our origin. */
const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept'] as const
/** Response headers passed back to the browser. */
const RETURNED_RESPONSE_HEADERS = ['content-type', 'cache-control'] as const
// posthog-js sends events to /e/ (or /i/v0/e/, /batch/) and loads exception
// autocapture from /static/exception-autocapture.js; the browser config blocks every
// other script, and flags, config and replay are never requested.
const EVENT_PATH = /^\/(?:e|i\/v0\/e|batch)\/?$/
const SCRIPT_PATH = /^\/static\/exception-autocapture\.js$/

export type PostHogUpstream = { api: string; assets: string }

/** PostHog's ingestion and asset hosts for an API host such as https://us.i.posthog.com. */
export function postHogUpstream(host: string): PostHogUpstream {
  const api = host.replace(/\/+$/, '')
  return {
    api,
    assets: api.includes('.i.posthog.com')
      ? api.replace('.i.posthog.com', '-assets.i.posthog.com')
      : api,
  }
}

/**
 * Proxies one posthog-js request under `/ingest` to PostHog with only the allowlisted
 * headers, or answers 404 for a path outside the event endpoints and the exception
 * autocapture script.
 */
export async function proxyPostHogIngest(
  request: Request,
  upstream: PostHogUpstream
): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/ingest(?=\/)/, '')
  const isEvent = request.method === 'POST' && EVENT_PATH.test(path)
  const isScript =
    (request.method === 'GET' || request.method === 'HEAD') && SCRIPT_PATH.test(path)
  if (!isEvent && !isScript) return new Response(null, { status: 404 })

  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const response = await fetch(
    `${isEvent ? upstream.api : upstream.assets}${path}${url.search}`,
    {
      method: request.method,
      headers,
      body: isEvent ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    }
  )
  const returned = new Headers()
  for (const name of RETURNED_RESPONSE_HEADERS) {
    const value = response.headers.get(name)
    if (value !== null) returned.set(name, value)
  }
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers: returned,
  })
}
