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

function pickHeaders(source: Headers, names: readonly string[]): Headers {
  const picked = new Headers()
  for (const name of names) {
    const value = source.get(name)
    if (value !== null) picked.set(name, value)
  }
  return picked
}

/** How long one proxied request may take, upstream response body included. */
export const POSTHOG_PROXY_DEADLINE_MS = 5_000
/** The largest event body the proxy accepts; posthog-js batches stay far below it. */
export const POSTHOG_PROXY_MAX_BODY_BYTES = 1024 * 1024

export type PostHogProxyOptions = { deadlineMs?: number; maxBodyBytes?: number }

/**
 * Reads the request body up to `maxBytes`, or returns null when it is larger. A declared
 * Content-Length over the cap is refused before reading; a streamed body is counted as
 * it arrives. Aborting `signal` stops the read.
 */
async function readCappedBody(
  request: Request,
  maxBytes: number,
  signal: AbortSignal
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN)
  if (declared > maxBytes) return null
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const cancel = () => void reader.cancel().catch(() => undefined)
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      // An abort that came before the listener (the browser already left) never fires
      // it, so every read starts by checking the signal.
      if (signal.aborted) {
        cancel()
        signal.throwIfAborted()
      }
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
  }
  signal.throwIfAborted()
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/**
 * Proxies one posthog-js request under `/ingest` to PostHog with only the allowlisted
 * headers, or answers 404 for a path outside the event endpoints and the exception
 * autocapture script and 413 for a body over the cap. The upstream request, its
 * response body included, ends when the browser leaves (`request.signal`) or the
 * deadline passes, whichever comes first; a request that ends that way before PostHog
 * answers gets 504, and a failed upstream connection gets 502.
 */
export async function proxyPostHogIngest(
  request: Request,
  upstream: PostHogUpstream,
  {
    deadlineMs = POSTHOG_PROXY_DEADLINE_MS,
    maxBodyBytes = POSTHOG_PROXY_MAX_BODY_BYTES,
  }: PostHogProxyOptions = {}
): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/ingest(?=\/)/, '')
  const isEvent = request.method === 'POST' && EVENT_PATH.test(path)
  const isScript =
    (request.method === 'GET' || request.method === 'HEAD') && SCRIPT_PATH.test(path)
  if (!isEvent && !isScript) return new Response(null, { status: 404 })

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deadlineMs)])
  let response: Response
  try {
    const body = isEvent ? await readCappedBody(request, maxBodyBytes, signal) : undefined
    if (body === null) return new Response(null, { status: 413 })
    response = await fetch(
      `${isEvent ? upstream.api : upstream.assets}${path}${url.search}`,
      {
        method: request.method,
        headers: pickHeaders(request.headers, FORWARDED_REQUEST_HEADERS),
        body,
        redirect: 'manual',
        cache: 'no-store',
        signal,
      }
    )
  } catch {
    return new Response(null, { status: signal.aborted ? 504 : 502 })
  }
  // The response body stays tied to `signal`: a client that leaves or a deadline that
  // passes mid-stream ends the upstream connection too.
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers: pickHeaders(response.headers, RETURNED_RESPONSE_HEADERS),
  })
}
