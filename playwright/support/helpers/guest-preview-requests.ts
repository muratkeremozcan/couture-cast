// Story 6.16 E1 and V1: which requests a signed-out guest page may make.

// Safe methods carry no body, so they cannot write a row (TEA ruling on E2E-002).
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])
// The two shapes apps/web/src/lib/posthog-ingest-proxy.ts forwards, restated here on
// purpose so a widened proxy fails this rule (prod run 43734744461 loaded the SDK
// exception bundle and failed E2E-002; PR 236 review narrowed the rule to these).
const INGEST_EVENT_PATH = /^\/ingest\/(?:e|i\/v0\/e|batch)\/?$/
const INGEST_SCRIPT_PATH = /^\/ingest\/static\/exception-autocapture\.js$/
const VERCEL_TOOLBAR_ORIGIN = 'https://vercel.live'
const VERCEL_TOOLBAR_PATH = /^\/(?:login|_next-live)\//

/**
 * A request the guest preview may make: a safe method (GET, HEAD or OPTIONS, no body) to
 * the web origin outside `/api/` (pages, RSC payloads, `_next` assets, and the probes a
 * preview deployment makes of them), or the two shapes the web origin's `/ingest/` PostHog
 * proxy forwards: a POST of an event batch, or a GET or HEAD of the SDK exception bundle.
 * A keyed build sends guest_preview_* batches there; what they may carry is proven on the
 * serialized bodies by `browser-analytics.wire.test.ts` (T-SERIALIZED-WEB), not here.
 * Paths are compared decoded, with repeated slashes collapsed and `/api` matched in any
 * case, so `//api/`, `/%61pi/` and `/API/` stay off. On a Vercel preview deployment only,
 * the toolbar Vercel injects (`https://vercel.live`, under `/login/` and `/_next-live/`)
 * is also allowed, because the deployment adds it and the app never calls it. Anything
 * else, the API and Supabase origins included, is off the allowlist.
 */
/** The path a server routes on, or null when it cannot be decoded. */
function normalizedPath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname).replace(/\/{2,}/g, '/')
  } catch {
    return null
  }
}

export function isAllowedGuestPreviewRequest(
  request: { method: string; url: string },
  webOrigin: string
): boolean {
  const url = new URL(request.url)
  if (url.origin === webOrigin) {
    const path = normalizedPath(url.pathname)
    if (path === null) return false
    if (/^\/ingest(?:\/|$)/i.test(path))
      return request.method === 'POST'
        ? INGEST_EVENT_PATH.test(path)
        : (request.method === 'GET' || request.method === 'HEAD') &&
            INGEST_SCRIPT_PATH.test(path)
    return SAFE_METHODS.has(request.method) && !/^\/api(?:\/|$)/i.test(path)
  }
  return isVercelPreviewToolbarRequest(request, webOrigin)
}

/**
 * The toolbar a Vercel preview deployment injects (`https://vercel.live`, under `/login/` and
 * `/_next-live/`). The deployment adds it and the app never calls it, so it is neither app
 * traffic nor an analytics event; on any other origin it is never excused.
 */
export function isVercelPreviewToolbarRequest(
  request: { url: string },
  webOrigin: string
): boolean {
  const url = new URL(request.url)
  return (
    new URL(webOrigin).hostname.endsWith('.vercel.app') &&
    url.origin === VERCEL_TOOLBAR_ORIGIN &&
    VERCEL_TOOLBAR_PATH.test(url.pathname)
  )
}
