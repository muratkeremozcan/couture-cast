// Story 6.16 E1 and V1: which requests a signed-out guest page may make.

// Safe methods carry no body, so they cannot write a row (TEA ruling on E2E-002).
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])
const VERCEL_TOOLBAR_ORIGIN = 'https://vercel.live'
const VERCEL_TOOLBAR_PATH = /^\/(?:login|_next-live)\//

/**
 * A request the guest preview may make: a safe method (GET, HEAD or OPTIONS, no body) to
 * the web origin outside `/api/` and `/ingest/` (pages, RSC payloads, `_next` assets, and
 * the probes a preview deployment makes of them). On a Vercel preview deployment only,
 * the toolbar Vercel injects (`https://vercel.live`, under `/login/` and `/_next-live/`)
 * is also allowed, because the deployment adds it and the app never calls it. Anything
 * else, the API and Supabase origins included, is off the allowlist.
 */
export function isAllowedGuestPreviewRequest(
  request: { method: string; url: string },
  webOrigin: string
): boolean {
  const url = new URL(request.url)
  if (url.origin === webOrigin)
    return SAFE_METHODS.has(request.method) && !/^\/(api|ingest)\//.test(url.pathname)
  return (
    new URL(webOrigin).hostname.endsWith('.vercel.app') &&
    url.origin === VERCEL_TOOLBAR_ORIGIN &&
    VERCEL_TOOLBAR_PATH.test(url.pathname)
  )
}
