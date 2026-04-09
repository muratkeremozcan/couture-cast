import {
  createApiClient,
  type ApiClientOptions,
  type DefaultApi,
} from '@couture/api-client'

// Story 0.9 Task 7 step 1 owner:
// give the web app one local SDK factory so same-origin defaults and auth behavior stay app-owned.
type WebApiClientOptions = Omit<ApiClientOptions, 'credentials'>

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

export function resolveWebApiBaseUrl() {
  return normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? '')
}

export function createWebApiClient(options: WebApiClientOptions = {}): DefaultApi {
  return createApiClient(resolveWebApiBaseUrl(), {
    ...options,
    credentials: 'include',
  })
}
