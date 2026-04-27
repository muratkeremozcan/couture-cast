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

export async function installApiProxy(page: Page, testInfo: TestInfo): Promise<void> {
  if (apiProxyStates.has(page)) {
    return
  }

  const state: ApiProxyState = {
    authOverrides: new Map(),
    baseUrl: resolveApiBaseUrl(testInfo),
  }
  apiProxyStates.set(page, state)

  await page.route(apiRoutePattern, (route) => proxyApiRequest(route, state))
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
