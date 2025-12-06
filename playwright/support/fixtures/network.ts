import type { Response, Route } from '@playwright/test'
import { test as base } from '@playwright/test'
import {
  interceptNetworkCall,
  type InterceptOptions,
  type NetworkCallResult,
} from '../helpers/intercept-network'

type RouteMatcher = string | RegExp

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

type WaitForApiResponseOptions = {
  url: RouteMatcher
  status?: number
  predicate?: (response: Response) => boolean
  method?: HttpMethod
}

type MockApiResponseOptions = {
  url: RouteMatcher
  status?: number
  body?: unknown
  headers?: Record<string, string>
  method?: HttpMethod
}

type NetworkFixture = {
  network: {
    waitForApiResponse: (options: WaitForApiResponseOptions) => Promise<Response>
    mockApiResponse: (options: MockApiResponseOptions) => Promise<void>
    interceptCall: (options: Omit<InterceptOptions, 'page'>) => Promise<NetworkCallResult>
  }
}

export const test = base.extend<NetworkFixture>({
  network: async ({ page }, use) => {
    const registeredRoutes: {
      matcher: RouteMatcher
      handler: Parameters<typeof page.route>[1]
    }[] = []

    const methodsMatch = (incoming: string, filter?: HttpMethod) => {
      if (!filter) {
        return true
      }
      return incoming.toUpperCase() === filter.toUpperCase()
    }

    const waitForApiResponse = (options: WaitForApiResponseOptions) => {
      const { url, status = 200, predicate, method } = options
      return page.waitForResponse((response) => {
        const matchesUrl =
          typeof url === 'string'
            ? response.url().includes(url)
            : url.test(response.url())
        if (!matchesUrl) {
          return false
        }

        const matchesMethod = methodsMatch(response.request().method(), method)
        const matchesStatus =
          typeof status === 'number' ? response.status() === status : true
        const predicateResult = predicate ? predicate(response) : true

        return matchesMethod && matchesStatus && predicateResult
      })
    }

    const mockApiResponse = async (options: MockApiResponseOptions) => {
      const { url, status = 200, body = {}, headers = {}, method } = options
      const handler = async (route: Route) => {
        if (!methodsMatch(route.request().method(), method)) {
          await route.continue()
          return
        }

        await route.fulfill({
          status,
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
            ...headers,
          },
        })
      }

      await page.route(url, handler)
      registeredRoutes.push({ matcher: url, handler })
    }

    const interceptCall = (options: Omit<InterceptOptions, 'page'>) =>
      interceptNetworkCall({
        ...options,
        page,
      })

    try {
      await use({
        waitForApiResponse,
        mockApiResponse,
        interceptCall,
      })
    } finally {
      await Promise.all(
        registeredRoutes.map(async ({ matcher, handler }) =>
          page.unroute(matcher, handler)
        )
      )
    }
  },
})
