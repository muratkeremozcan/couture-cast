import {
  createApiClient,
  type ApiClientOptions,
  type DefaultApi,
} from '@couture/api-client'

// Story 0.9 Task 7 step 2 owner:
// keep mobile base URL and auth resolution local to the Expo surface before calling the shared SDK.
function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

export function resolveMobileApiBaseUrl() {
  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL

  if (!baseUrl) {
    throw new Error(
      'Mobile API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL or API_BASE_URL.'
    )
  }

  return normalizeBaseUrl(baseUrl)
}

export function createMobileApiClient(options: ApiClientOptions = {}): DefaultApi {
  return createApiClient(resolveMobileApiBaseUrl(), options)
}
