import {
  userProfileResponseSchema,
  userPreferencesResponseSchema,
  type SupportedLocale,
  type UserProfileResponse,
} from '@couture/api-client/contracts/http'
import { createMobileApiClient, resolveMobileApiBaseUrl } from './api-client'
import { resolveMobileAccessToken } from './mobile-auth'

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message ?? `User request failed with status ${response.status}`
  } catch {
    return `User request failed with status ${response.status}`
  }
}

export async function getUserProfileFromMobile(
  fetchImpl: typeof fetch = fetch
): Promise<UserProfileResponse> {
  const response = await fetchImpl(`${resolveMobileApiBaseUrl()}/api/v1/user/profile`, {
    method: 'GET',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return userProfileResponseSchema.parse(await response.json())
}

export async function updatePreferredLocaleFromMobile(locale: SupportedLocale) {
  const client = createMobileApiClient({
    accessToken: async () => (await resolveMobileAccessToken()) || '',
  })
  const response = await client.apiV1UserPreferencesPut({
    userPreferencesInput: { locale },
  })
  return userPreferencesResponseSchema.parse(response)
}
