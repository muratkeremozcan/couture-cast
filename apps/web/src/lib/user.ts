import {
  userProfileResponseSchema,
  type UserProfileResponse,
} from '@couture/api-client/contracts/http'
import { createWebApiClient, resolveWebApiBaseUrl } from './api-client'
import { readStorage } from './browser-persistence'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message ?? `User request failed with status ${response.status}`
  } catch {
    return `User request failed with status ${response.status}`
  }
}

export async function getUserProfileFromWeb(
  fetchImpl: typeof fetch = fetch
): Promise<UserProfileResponse> {
  const response = await fetchImpl(`${resolveWebApiBaseUrl()}/api/v1/user/profile`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return userProfileResponseSchema.parse(await response.json())
}

/**
 * The signed-in member's profile, with the bearer this tab holds (the same one
 * every signed-in section sends). The Profile page header names the account
 * from it.
 */
export async function getSignedInUserProfileFromWeb(
  signal?: AbortSignal
): Promise<UserProfileResponse> {
  const token = readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim()
  if (!token) throw new Error('Sign in to see your profile.')
  return userProfileResponseSchema.parse(
    await createWebApiClient({ accessToken: token }).apiV1UserProfileGet({ signal })
  )
}
