import {
  userProfileResponseSchema,
  type UserProfileResponse,
} from '@couture/api-client/contracts/http'
import { resolveWebApiBaseUrl } from './api-client'

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
