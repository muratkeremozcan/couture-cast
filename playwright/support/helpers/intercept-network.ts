import type { Page, Request, Response, Route } from '@playwright/test'
import picomatch from 'picomatch'

export type FulfillResponse = {
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

type PreparedResponse = {
  status?: number
  headers?: Record<string, string>
  body?: string | Buffer
}

export type InterceptOptions = {
  method?: string
  url?: string | RegExp
  page: Page
  fulfillResponse?: FulfillResponse
  handler?: (route: Route, request: Request) => Promise<void> | void
}

export type NetworkCallResult = {
  request: Request | null
  response: Response | null
  responseJson: unknown
  status: number
  requestJson: unknown
}

export async function interceptNetworkCall({
  method,
  url,
  page,
  fulfillResponse,
  handler,
}: InterceptOptions): Promise<NetworkCallResult> {
  if (!page) {
    throw new Error('The `page` argument is required for network interception')
  }

  if (fulfillResponse || handler) {
    return fulfillNetworkCall(page, method, url, fulfillResponse, handler)
  }

  return observeNetworkCall(page, method, url)
}

async function fulfillNetworkCall(
  page: Page,
  method?: string,
  url?: string | RegExp,
  fulfillResponse?: FulfillResponse,
  handler?: (route: Route, request: Request) => Promise<void> | void
): Promise<NetworkCallResult> {
  const routePattern =
    typeof url === 'string'
      ? url.startsWith('**')
        ? url
        : `**${url ?? '*'}`
      : (url ?? '**/*')
  const preparedResponse = prepareResponse(fulfillResponse)

  let resolveRequest: (request: Request) => void
  const requestPromise = new Promise<Request>((resolve) => {
    resolveRequest = resolve
  })

  const routeHandler = async (route: Route, request: Request) => {
    if (matchesRequest(request, method, url)) {
      resolveRequest(request)

      if (handler) {
        await handler(route, request)
      } else if (preparedResponse) {
        await route.fulfill(preparedResponse)
      }
    } else {
      await route.continue()
    }
  }

  await page.route(routePattern, routeHandler)

  const request = await requestPromise
  await page.unroute(routePattern, routeHandler)
  let requestJson: unknown = null
  try {
    requestJson = await request.postDataJSON()
  } catch {
    // Request body not JSON
  }

  return {
    request,
    response: null,
    responseJson: fulfillResponse?.body ?? null,
    status: fulfillResponse?.status ?? 200,
    requestJson,
  }
}

async function observeNetworkCall(
  page: Page,
  method?: string,
  url?: string | RegExp
): Promise<NetworkCallResult> {
  const request = await page.waitForRequest((req) => matchesRequest(req, method, url))
  const response = await request.response()
  if (!response) {
    throw new Error('No response received for the request')
  }

  let responseJson: unknown = null
  try {
    const contentType = response.headers()['content-type']
    if (contentType?.includes('application/json')) {
      responseJson = await response.json()
    }
  } catch {
    // Non-JSON response
  }

  let requestJson: unknown = null
  try {
    requestJson = await request.postDataJSON()
  } catch {
    // No JSON body
  }

  return {
    request,
    response,
    responseJson,
    status: response.status(),
    requestJson,
  }
}

function matchesRequest(request: Request, method?: string, urlPattern?: string | RegExp) {
  const matchesMethod = !method || request.method() === method
  const matcher = createUrlMatcher(urlPattern)
  const matchesUrl = matcher(request.url())
  return matchesMethod && matchesUrl
}

function createUrlMatcher(pattern?: string | RegExp) {
  if (!pattern) return () => true
  if (pattern instanceof RegExp) {
    return (url: string) => pattern.test(url)
  }
  const globPattern = pattern.startsWith('**') ? pattern : `**${pattern}`
  const isMatch = picomatch(globPattern)
  return isMatch
}

function prepareResponse(
  fulfillResponse?: FulfillResponse
): PreparedResponse | undefined {
  if (!fulfillResponse) return undefined

  const { status = 200, headers = {}, body } = fulfillResponse
  const contentType = headers['Content-Type'] || 'application/json'

  return {
    status,
    headers: {
      'Content-Type': contentType,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }
}
