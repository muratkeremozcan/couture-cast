// Proxies browser-origin API calls to the configured API host so UI smoke tests can
// exercise real backend contracts even when the Next.js app is served from another origin.
import type { Page, Route, TestInfo } from '@playwright/test'
import type { NetworkCallResult } from '@seontechnologies/playwright-utils/intercept-network-call'
import { authHeaders, resolveApiBaseUrl, type ApiRole } from './api-test'

type ApiProxyRouteOptions = {
  auth?: {
    role: ApiRole
    userId: string
  }
}

type ProxyApiCallOptions = ApiProxyRouteOptions & {
  interceptNetworkCall: InterceptNetworkCallFn
  method: 'GET' | 'POST'
  page: Page
  path: string
}

type ApiProxyState = {
  authOverrides: Map<string, ApiProxyRouteOptions['auth']>
  baseUrl: string
  /** Proxied calls still running, so the drain lets them finish before it unroutes. */
  inFlight: Set<Promise<void>>
  /** Set once teardown starts draining. */
  draining: boolean
}

type InterceptNetworkCallOptions = {
  method?: string
  url?: string
}

type InterceptNetworkCallFn = (
  options: InterceptNetworkCallOptions
) => Promise<NetworkCallResult>

const apiRoutePattern = '**/api/v1/**'
const apiProxyStates = new WeakMap<Page, ApiProxyState>()

function apiProxyKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}

function apiProxyKeyFromRoute(route: Route): string {
  const request = route.request()
  return apiProxyKey(request.method(), new URL(request.url()).pathname)
}

function resolveCorsHeaders(requestUrl: string, requestHeaders: Record<string, string>) {
  const origin = requestHeaders.origin ?? new URL(requestUrl).origin

  return {
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers':
      requestHeaders['access-control-request-headers'] ??
      'authorization,content-type,x-user-id,x-user-role',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': origin,
  }
}

function buildApiProxyUrl(route: Route, baseUrl: string): string {
  const requestUrl = new URL(route.request().url())
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, baseUrl).toString()
}

function buildApiProxyHeaders(
  route: Route,
  state: ApiProxyState
): Record<string, string> {
  const headers = { ...route.request().headers() }
  delete headers.host
  delete headers['content-length']
  // The browser's cookie header belongs to the web origin. On a protected preview it holds the web
  // deployment's bypass cookie, which the API rejects, and it would hide the API's own cookie that
  // `route.fetch` takes from the context's jar. Dropping it lets the jar answer for the API origin.
  delete headers.cookie

  const auth = state.authOverrides.get(apiProxyKeyFromRoute(route))
  if (!auth) {
    return headers
  }

  return {
    ...headers,
    ...authHeaders(auth.userId, auth.role),
  }
}

async function proxyApiRequest(route: Route, state: ApiProxyState) {
  const request = route.request()
  const headers = buildApiProxyHeaders(route, state)

  if (request.method() === 'OPTIONS') {
    await route.fulfill({
      status: 204,
      headers: resolveCorsHeaders(request.url(), request.headers()),
    })
    return
  }

  const response = await route.fetch({
    url: buildApiProxyUrl(route, state.baseUrl),
    headers,
    maxRetries: 1,
  })
  const responseText = await response.text()

  await route.fulfill({
    response,
    body: responseText,
    headers: {
      ...response.headers(),
      ...resolveCorsHeaders(request.url(), headers),
    },
  })
}

/**
 * Lets a proxied call in flight finish, so call before the page's context closes.
 * Closing first disposes the fetch, and Playwright records a failed step in the report even in a passing test.
 * That step's call log lists the request headers, with the Vercel `_vercel_jwt` cookie among them, and the
 * cookie's payload carries the bypass secret, so `check-artifact-secrets` rightly refuses the upload.
 */
export async function drainApiProxy(
  page: Pick<Page, 'isClosed' | 'unrouteAll'>
): Promise<void> {
  const state = apiProxyStates.get(page as Page)
  if (!state || page.isClosed()) return
  state.draining = true
  // `unrouteAll` takes the interception away first, and Playwright then sends every route still in
  // flight on to the network, so a call still fetching would find its route handled. Measured on
  // preview 2026-11-11: 7 of 40 P-D-PREVIEW-CLOSED runs failed exactly that way in teardown.
  while (state.inFlight.size > 0) await Promise.allSettled([...state.inFlight])
  await page.unrouteAll({ behavior: 'wait' })
}

const isAlreadyHandled = (error: unknown) =>
  error instanceof Error && /Route is already handled/.test(error.message)

/**
 * A last resort for a page something closed mid-call, which `drainApiProxy` could not reach. Nobody is waiting
 * for that answer. Any other failure, or this one on a page that is still open, is real.
 */
export function isAbandonedByClose(
  error: unknown,
  page: Pick<Page, 'isClosed'>
): boolean {
  return (
    page.isClosed() &&
    error instanceof Error &&
    /Request context disposed|Response has been disposed|Test ended|Target page, context or browser has been closed/.test(
      error.message
    )
  )
}

/**
 * A call the page itself gave up on while the proxy fetched it: a client-side navigation aborts the old
 * page's fetches, Playwright marks their routes handled, and the proxy's `route.fulfill` then throws.
 * Nobody waits for that answer. Measured on preview 2026-11-11: P-D-PREVIEW-CLOSED clicks into a case
 * while the queue's `evidence-exports/availability` read is in flight, about 1 run in 40. The fulfill
 * can fail before the request's failure reaches the test, so the request settles first; `response()`
 * resolves null once it failed.
 */
export async function isAbandonedByPage(
  error: unknown,
  request: Pick<ReturnType<Route['request']>, 'failure' | 'response'>,
  settleMs = 2_000
): Promise<boolean> {
  if (!isAlreadyHandled(error)) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    request.response().catch(() => null),
    new Promise((resolve) => (timer = setTimeout(resolve, settleMs))),
  ])
  clearTimeout(timer)
  return /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(
    request.failure()?.errorText ?? ''
  )
}

export async function installApiProxy(page: Page, testInfo: TestInfo): Promise<void> {
  if (apiProxyStates.has(page)) {
    return
  }

  const state: ApiProxyState = {
    authOverrides: new Map(),
    baseUrl: resolveApiBaseUrl(testInfo),
    inFlight: new Set(),
    draining: false,
  }
  apiProxyStates.set(page, state)

  await page.route(apiRoutePattern, async (route) => {
    const call = (async () => {
      try {
        await proxyApiRequest(route, state)
      } catch (error) {
        if (isAbandonedByClose(error, page)) return
        // A call that started after the drain's wait: teardown sent it on, and nobody waits for it.
        if (state.draining && isAlreadyHandled(error)) return
        if (!(await isAbandonedByPage(error, route.request()))) throw error
      }
    })()
    state.inFlight.add(call)
    try {
      await call
    } finally {
      state.inFlight.delete(call)
    }
  })
}

export async function proxyApiCall<TRequest = unknown, TResponse = unknown>({
  auth,
  interceptNetworkCall,
  method,
  page,
  path,
}: ProxyApiCallOptions): Promise<NetworkCallResult<TRequest, TResponse>> {
  const state = apiProxyStates.get(page)
  if (!state) {
    throw new Error('Install the browser API proxy before calling proxyApiCall.')
  }

  const key = apiProxyKey(method, path)
  state.authOverrides.set(key, auth)

  try {
    const result = await interceptNetworkCall({ method, url: path })

    const proxiedResult: NetworkCallResult<TRequest, TResponse> = {
      request: result.request,
      response: result.response,
      status: result.status,
      responseJson: result.responseJson as TResponse | null,
      requestJson: result.requestJson as TRequest | null,
    }

    return proxiedResult
  } finally {
    state.authOverrides.delete(key)
  }
}
