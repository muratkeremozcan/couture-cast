/**
 * The same-origin /api/v1 proxy a preview web deployment uses to reach its preview API.
 *
 * Production and local builds rewrite /api/v1 straight to the API (next.config.ts). A
 * preview API sits behind Vercel Deployment Protection, and a rewrite cannot add the
 * protection bypass header, so a preview web with a plain rewrite gets Vercel's login page
 * for every API call and only works under Playwright's browser-side proxy. When a preview
 * deployment has both an API base URL and PREVIEW_API_PROTECTION_BYPASS_SECRET, next.config.ts
 * rewrites /api/v1 to the route handler below instead, which forwards the request with the
 * bypass header added on the server. The secret is read from the environment only and is
 * never logged or returned. Production never enables it.
 */

export const PREVIEW_API_PROXY_ROUTE = '/api/preview-api'
export const PROTECTION_BYPASS_HEADER = 'x-vercel-protection-bypass'

export type PreviewApiProxyConfig = { baseUrl: string; bypassSecret: string }

type Env = Readonly<Record<string, string | undefined>>

/**
 * The API base URL a preview build proxies to: the same variables, in the same order, that
 * next.config.ts reads for a production-mode build, less PROD_API_BASE_URL.
 */
function previewApiBaseUrl(env: Env): string {
  return (
    env.VERCEL_API_BASE_URL ||
    env.VERCEL_API_BRANCH_URL ||
    env.API_BASE_URL ||
    env.PREVIEW_API_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '')
}

/**
 * The proxy's configuration, or null when this deployment must not proxy: a production
 * deployment, a missing secret, or a base URL that is not an https origin.
 */
export function previewApiProxyConfig(
  env: Env = process.env
): PreviewApiProxyConfig | null {
  if (env.VERCEL_ENV !== 'preview') return null
  const bypassSecret = env.PREVIEW_API_PROTECTION_BYPASS_SECRET?.trim() ?? ''
  if (!bypassSecret) return null
  const configured = previewApiBaseUrl(env)
  if (!configured) return null
  // A fragment would swallow the appended path and query, and user information makes fetch
  // refuse the URL: both are rejected, and the destination is built from the parsed origin.
  if (/[#@]/.test(configured)) return null
  let baseUrl: string
  try {
    const parsed = new URL(configured)
    if (
      parsed.protocol !== 'https:' ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    )
      return null
    baseUrl = parsed.origin
  } catch {
    return null
  }
  return { baseUrl, bypassSecret }
}

/** Hop-by-hop and per-connection request headers the upstream fetch sets itself. */
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
])

/** Response headers that describe the upstream connection or an encoding fetch removed. */
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
  // The API sets no cookie and the web reads none, so nothing is allowed through: a platform
  // cookie (the deployment JWT or a bypass cookie) would open the protected API directly.
  'set-cookie',
])

/**
 * A path segment that could leave /api/v1 once the upstream URL is normalized: a dot segment
 * (after decoding, so %2e%2e counts) or one carrying a slash or backslash.
 */
function isUnsafeSegment(segment: string): boolean {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return true
  }
  return decoded === '.' || decoded === '..' || /[/\\]/.test(decoded)
}

/** Vercel's own cookie names (`_vercel_jwt`, the bypass cookie and any later `_vercel*`). */
const isVercelCookieName = (name: string) => /^_+vercel/i.test(name.trim())

/**
 * The query without Vercel's reserved deployment-protection options (`x-vercel-set-bypass-cookie`,
 * `x-vercel-protection-bypass` and any other `x-vercel-*` name), which would otherwise ask the
 * protected API for a cookie that opens it directly. Every other part passes through as sent.
 */
function withoutVercelQueryOptions(search: string): string {
  const kept = search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => {
      if (!part) return false
      const rawName = part.split('=')[0] ?? ''
      let name = rawName
      try {
        name = decodeURIComponent(rawName.replace(/\+/g, ' '))
      } catch {
        // An undecodable name is compared as written.
      }
      return !name.trim().toLowerCase().startsWith('x-vercel-')
    })
  return kept.length ? `?${kept.join('&')}` : ''
}

/** Removes Vercel's own cookies (the web deployment's share/auth JWT) from a Cookie header. */
function withoutVercelCookies(cookie: string): string {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !isVercelCookieName(part.split('=')[0] ?? ''))
    .join('; ')
}

function upstreamRequestHeaders(source: Headers, bypassSecret: string): Headers {
  const headers = new Headers()
  source.forEach((value, name) => {
    const key = name.toLowerCase()
    // A browser-sent x-vercel-* header (a bypass attempt included) never reaches the API.
    if (DROPPED_REQUEST_HEADERS.has(key) || key.startsWith('x-vercel-')) return
    if (key === 'cookie') {
      const kept = withoutVercelCookies(value)
      if (kept) headers.set('cookie', kept)
      return
    }
    headers.set(name, value)
  })
  headers.set(PROTECTION_BYPASS_HEADER, bypassSecret)
  return headers
}

function browserResponseHeaders(source: Headers): Headers {
  const headers = new Headers()
  source.forEach((value, name) => {
    const key = name.toLowerCase()
    // The bypass secret never reaches the browser, even if the upstream echoes it back.
    if (DROPPED_RESPONSE_HEADERS.has(key) || key === PROTECTION_BYPASS_HEADER) return
    headers.set(name, value)
  })
  return headers
}

/**
 * Forwards one /api/v1 request to the preview API: same method, path, query, body and
 * headers (less hop-by-hop and Vercel's own), plus the protection bypass header. Redirects
 * pass through unfollowed. Answers 404 when this deployment is not configured to proxy or a
 * path segment could leave /api/v1, and
 * 502 when the API cannot be reached; the upstream request ends when the browser leaves.
 */
export async function proxyPreviewApi(
  request: Request,
  pathSegments: readonly string[],
  config: PreviewApiProxyConfig | null = previewApiProxyConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  if (!config) return new Response('Not Found', { status: 404 })
  // Every forwarded call stays under /api/v1 on the API host.
  if (pathSegments.some(isUnsafeSegment))
    return new Response('Not Found', { status: 404 })
  const search = withoutVercelQueryOptions(new URL(request.url).search)
  const path = pathSegments.map((segment) => encodeURIComponent(segment)).join('/')
  const target = `${config.baseUrl}/api/v1/${path}${search}`
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  let upstream: Response
  try {
    upstream = await fetchImpl(target, {
      method: request.method,
      headers: upstreamRequestHeaders(request.headers, config.bypassSecret),
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
      signal: request.signal,
      // Streams the request body instead of buffering it; required by Node's fetch.
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit)
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 })
    console.error('preview API proxy: upstream request failed', {
      name: error instanceof Error ? error.name : 'unknown',
    })
    return new Response('Bad Gateway', { status: 502 })
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: browserResponseHeaders(upstream.headers),
  })
}
