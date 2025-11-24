import { test as base } from '@playwright/test'
import {
  apiRequest,
  type ApiRequestParams,
  type ApiResponsePayload,
} from '../helpers/api-client'
import { resolveEnvironmentConfig } from '../config/environments'

type ApiClientFixture = {
  apiClient: <TResponse = unknown, TRequest = unknown>(
    params: Omit<ApiRequestParams<TRequest>, 'request' | 'baseURL'>
  ) => Promise<ApiResponsePayload<TResponse>>
}

export const test = base.extend<ApiClientFixture>({
  apiClient: async ({ request }, use) => {
    const env = resolveEnvironmentConfig(process.env.TEST_ENV)

    await use(
      <TResponse, TRequest>(
        params: Omit<ApiRequestParams<TRequest>, 'request' | 'baseURL'>
      ) =>
        apiRequest<TResponse, TRequest>({
          ...params,
          baseURL: env.apiBaseUrl,
          request,
          headers: {
            ...env.apiHeaders,
            ...params.headers,
          },
        })
    )
  },
})
